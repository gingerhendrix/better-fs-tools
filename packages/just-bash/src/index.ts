/**
 * Adapt a `just-bash` POSIX filesystem to the `FileSystem` handle contract.
 *
 * `IFileSystem` exposes whole-buffer, path-based operations. This adapter
 * therefore declares `streaming: false`, copies the backend buffer during
 * `open()`, and verifies by repeating canonicalization and stat inspection.
 * It cannot provide the descriptor identity, non-blocking special-file open,
 * or in-flight cancellation guarantees of a descriptor-based Node adapter.
 *
 * Policy remains adapter-owned. Requested paths are checked against virtual
 * roots before the backend is touched and canonical paths are checked again
 * after `realpath()`. Backend errors are reduced to a bounded POSIX code and a
 * safe phase; raw messages, which can contain paths, never leave this module.
 */
import type { FsStat, IFileSystem } from "just-bash";

import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type {
  DirectoryEntry,
  FileSystem,
  FileSystemError,
  ListOptions,
  ListOutcome,
  NotAFileError,
  OpenFile,
  OpenOptions,
  OpenOutcome,
  VerifyOutcome,
} from "@better-fs-tools/fs";

const MAX_IDENTITY_LENGTH = 1_024;

export type JustBashIdentityMode = "required" | "none";
export type JustBashSymlinkPolicy = "reject" | "backend-policy";

export interface JustBashReadFileSystemOptions {
  /** Namespaces public identities and appears in `FileInfo.backend`. */
  readonly id: string;
  /** Absolute virtual POSIX working directory. Defaults to `/`. */
  readonly cwd?: string;
  /** Virtual roots that may be read. Relative values resolve against `cwd`. */
  readonly allowedRoots: readonly string[];
  /** Virtual roots that remain refused even when nested in an allowed root. */
  readonly denyRoots?: readonly string[];
  /** Maximum accepted whole-file buffer. Required so buffering is explicit. */
  readonly maxBufferedBytes: number;
  /** Stable backend identity is opt-in. Defaults to `none`. */
  readonly identity?: JustBashIdentityMode;
  /** Final symlinks are refused unless backend policy is selected explicitly. */
  readonly symlinks?: JustBashSymlinkPolicy;
}

export interface JustBashReadFileSystem extends FileSystem {
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly denyRoots: readonly string[];
  readonly maxBufferedBytes: number;
  readonly identityMode: JustBashIdentityMode;
  readonly symlinkPolicy: JustBashSymlinkPolicy;
  list(path: string, options: ListOptions): Promise<ListOutcome>;
}

interface ValidatedStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly size: number;
  readonly mtimeMs: number;
  readonly identity?: string;
  readonly dev?: number | bigint;
  readonly ino?: number | bigint;
}

interface ValidatedDirent {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
}

/**
 * Wrap the exact public `IFileSystem` contract exported by `just-bash`.
 *
 * Reads are buffered during `open()`. Abort checks bracket every uncancellable
 * backend promise, but cannot stop one already in flight. Directory backends
 * also return complete arrays: `limit` bounds converted output and fallback
 * `lstat()` calls, not backend traversal or allocation.
 */
export function justBashReadFileSystem(
  fs: IFileSystem,
  options: JustBashReadFileSystemOptions,
): JustBashReadFileSystem {
  validateFileSystem(fs);
  const configured = validateOptions(options);
  const { id, cwd, allowedRoots, denyRoots, maxBufferedBytes, identityMode, symlinkPolicy } =
    configured;

  return Object.freeze({
    id,
    capabilities: Object.freeze({
      streaming: false,
      identity: identityMode === "required",
    }),
    paths: posixPaths,
    cwd,
    allowedRoots,
    denyRoots,
    maxBufferedBytes,
    identityMode,
    symlinkPolicy,

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      const signal = callOptions.signal;
      if (signal?.aborted) return { ok: false, error: { reason: "aborted" } };

      try {
        const lexical = authorizeRequested(cwd, requested, allowedRoots, denyRoots);
        const leaf = await inspect(fs, "lstat", lexical, signal);
        if (symlinkPolicy === "reject" && leaf.isSymbolicLink) {
          throw refuse({
            reason: "denied",
            detail: "the path is a symbolic link and this adapter refuses it",
          });
        }

        const resolved = await canonicalPath(fs, lexical, signal);
        authorizeCanonical(resolved, allowedRoots, denyRoots);

        const before = await inspect(fs, "stat", resolved, signal, "stat-before");
        requireRegularFile(before, cwd, resolved);
        requireWithinCeiling(before.size, maxBufferedBytes, "reported object");
        const beforeKey = requireStatKey(before, identityMode);

        const backendBytes = await backendCall(
          () => fs.readFileBuffer(resolved),
          "readFileBuffer",
          signal,
        );
        if (!(backendBytes instanceof Uint8Array)) {
          throw invalid("readFileBuffer returned a non-Uint8Array", "readFileBuffer");
        }
        requireWithinCeiling(backendBytes.byteLength, maxBufferedBytes, "returned object");

        /* `InMemoryFs` aliases its stored buffer, so ownership must change here. */
        const bytes = Uint8Array.from(backendBytes);
        const after = await inspect(fs, "stat", resolved, signal, "stat-after");
        requireRegularFile(after, cwd, resolved);

        const afterKey = requireStatKey(after, identityMode);
        const beforeFingerprint = fingerprint(id, resolved, beforeKey, before);
        const openedFingerprint = fingerprint(id, resolved, afterKey, after);
        if (beforeFingerprint !== openedFingerprint || bytes.byteLength !== after.size) {
          throw refuse({
            reason: "io",
            detail: "the path changed while opening the buffered snapshot",
            cause: { code: "OPEN_CHANGED", phase: "open-verify" },
          });
        }

        return {
          ok: true,
          file: justBashOpenFile({
            fs,
            id,
            cwd,
            lexical,
            resolved,
            allowedRoots,
            denyRoots,
            identityMode,
            symlinkPolicy,
            opened: after,
            openedFingerprint,
            bytes,
            ...(signal === undefined ? {} : { signal }),
          }),
        };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },

    async list(requested: string, listOptions: ListOptions): Promise<ListOutcome> {
      const signal = listOptions.signal;
      if (signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      const { limit } = listOptions;
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        return {
          ok: false,
          error: { reason: "io", detail: "list limit must be a positive safe integer" },
        };
      }

      try {
        const lexical = authorizeRequested(cwd, requested, allowedRoots, denyRoots);
        const leaf = await inspect(fs, "lstat", lexical, signal);
        if (symlinkPolicy === "reject" && leaf.isSymbolicLink) {
          throw refuse({
            reason: "denied",
            detail: "the path is a symbolic link and this adapter refuses it",
          });
        }
        const resolved = await canonicalPath(fs, lexical, signal);
        authorizeCanonical(resolved, allowedRoots, denyRoots);
        const stat = await inspect(fs, "stat", resolved, signal);
        /* Same rule as memoryFileSystem: listing a non-directory is not-found. */
        if (!stat.isDirectory) throw refuse({ reason: "not-found", detail: "not a directory" });

        /*
         * Both methods allocate a complete backend array. Slicing bounds only
         * returned entries and, on the fallback path, child metadata calls.
         */
        if (typeof fs.readdirWithFileTypes === "function") {
          const readdirWithFileTypes = fs.readdirWithFileTypes;
          const raw = await backendCall(
            () => readdirWithFileTypes.call(fs, resolved),
            "readdirWithFileTypes",
            signal,
          );
          if (!Array.isArray(raw)) {
            throw invalid("readdirWithFileTypes returned a non-array", "readdirWithFileTypes");
          }
          const entries: DirectoryEntry[] = [];
          for (const value of raw.slice(0, limit)) {
            if (signal?.aborted) throw refuse({ reason: "aborted" });
            entries.push(directoryEntry(validateDirent(value)));
          }
          return { ok: true, entries, truncated: raw.length > limit };
        }

        const raw = await backendCall(() => fs.readdir(resolved), "readdir", signal);
        if (!Array.isArray(raw)) throw invalid("readdir returned a non-array", "readdir");
        const names = raw.slice(0, limit).map((value) => validateEntryName(value, "readdir"));
        const entries: DirectoryEntry[] = [];
        for (const name of names) {
          const child = resolvePosix(resolved, name);
          if (posixPaths.dirname(child) !== resolved) {
            throw invalid("readdir returned an entry outside the listed directory", "readdir");
          }
          const childStat = await inspect(fs, "lstat", child, signal, "list-lstat");
          entries.push({ name, type: statType(childStat) });
        }
        return { ok: true, entries, truncated: raw.length > limit };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The buffered handle                                                        */
/* -------------------------------------------------------------------------- */

function justBashOpenFile(context: {
  fs: IFileSystem;
  id: string;
  cwd: string;
  lexical: string;
  resolved: string;
  allowedRoots: readonly string[];
  denyRoots: readonly string[];
  identityMode: JustBashIdentityMode;
  symlinkPolicy: JustBashSymlinkPolicy;
  opened: ValidatedStat;
  openedFingerprint: string;
  bytes: Uint8Array;
  signal?: AbortSignal;
}): OpenFile {
  let consumed = false;
  let closed = false;

  return {
    info: {
      resolvedPath: context.resolved,
      displayPath: display(context.cwd, context.resolved),
      size: context.bytes.byteLength,
      mtimeMs: context.opened.mtimeMs,
      identity: context.identityMode === "required" ? context.openedFingerprint : null,
      mimeType: null,
      /* The fingerprint verify() compares. Weak in identity mode "none". */
      version: context.openedFingerprint,
    },

    bytes(): AsyncIterable<Uint8Array> {
      if (consumed) throw new TypeError("just-bash byte source is single-use");
      consumed = true;
      let sent = closed || context.bytes.byteLength === 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<Uint8Array>> {
              if (sent || closed || context.signal?.aborted)
                return { done: true, value: undefined };
              sent = true;
              return { done: false, value: context.bytes };
            },
            async return(): Promise<IteratorResult<Uint8Array>> {
              sent = true;
              return { done: true, value: undefined };
            },
          };
        },
      };
    },

    async verify(): Promise<VerifyOutcome> {
      try {
        const leaf = await inspect(
          context.fs,
          "lstat",
          context.lexical,
          context.signal,
          "verify-lstat",
        );
        if (context.symlinkPolicy === "reject" && leaf.isSymbolicLink) {
          return { ok: true, changed: true };
        }
        const currentResolved = await canonicalPath(
          context.fs,
          context.lexical,
          context.signal,
          "verify-realpath",
        );
        try {
          authorizeCanonical(currentResolved, context.allowedRoots, context.denyRoots);
        } catch (error) {
          if (error instanceof AdapterRefusal) return { ok: true, changed: true };
          throw error;
        }
        if (currentResolved !== context.resolved) return { ok: true, changed: true };

        const current = await inspect(
          context.fs,
          "stat",
          currentResolved,
          context.signal,
          "verify-stat",
        );
        if (!current.isFile) return { ok: true, changed: true };
        const key = requireStatKey(current, context.identityMode);
        return {
          ok: true,
          changed:
            fingerprint(context.id, context.resolved, key, current) !== context.openedFingerprint,
        };
      } catch (error) {
        const mapped = toFileSystemError(error);
        if (mapped.reason === "not-found") return { ok: true, changed: true };
        return { ok: false, error: mapped };
      }
    },

    async close(): Promise<void> {
      closed = true;
      consumed = true;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Policy and validation                                                      */
/* -------------------------------------------------------------------------- */

function validateOptions(options: JustBashReadFileSystemOptions): {
  id: string;
  cwd: string;
  allowedRoots: readonly string[];
  denyRoots: readonly string[];
  maxBufferedBytes: number;
  identityMode: JustBashIdentityMode;
  symlinkPolicy: JustBashSymlinkPolicy;
} {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("justBashReadFileSystem options must be an object");
  }
  if (typeof options.id !== "string" || options.id === "" || options.id.includes("\0")) {
    throw new TypeError("id must be a non-empty string without NUL");
  }
  const cwd = validateAbsolutePath(options.cwd ?? "/", "cwd");
  if (!Array.isArray(options.allowedRoots) || options.allowedRoots.length === 0) {
    throw new TypeError("allowedRoots must be a non-empty array");
  }
  const allowedRoots = Object.freeze(
    options.allowedRoots.map((root) => validateConfiguredRoot(cwd, root)),
  );
  if (options.denyRoots !== undefined && !Array.isArray(options.denyRoots)) {
    throw new TypeError("denyRoots must be an array");
  }
  const denyRoots = Object.freeze(
    (options.denyRoots ?? []).map((root) => validateConfiguredRoot(cwd, root)),
  );
  if (!Number.isSafeInteger(options.maxBufferedBytes) || options.maxBufferedBytes <= 0) {
    throw new TypeError("maxBufferedBytes must be a positive safe integer");
  }
  const identityMode = options.identity ?? "none";
  if (identityMode !== "required" && identityMode !== "none") {
    throw new TypeError('identity must be "required" or "none"');
  }
  const symlinkPolicy = options.symlinks ?? "reject";
  if (symlinkPolicy !== "reject" && symlinkPolicy !== "backend-policy") {
    throw new TypeError('symlinks must be "reject" or "backend-policy"');
  }
  return {
    id: options.id,
    cwd,
    allowedRoots,
    denyRoots,
    maxBufferedBytes: options.maxBufferedBytes,
    identityMode,
    symlinkPolicy,
  };
}

function validateFileSystem(fs: IFileSystem): void {
  if (fs === null || typeof fs !== "object" || Array.isArray(fs)) {
    throw new TypeError("justBashReadFileSystem needs an IFileSystem object");
  }
  for (const method of ["lstat", "realpath", "stat", "readFileBuffer", "readdir"] as const) {
    if (typeof fs[method] !== "function")
      throw new TypeError(`the IFileSystem must implement ${method}()`);
  }
  if (fs.readdirWithFileTypes !== undefined && typeof fs.readdirWithFileTypes !== "function") {
    throw new TypeError("IFileSystem readdirWithFileTypes must be a function when present");
  }
}

function validateAbsolutePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "" || !value.startsWith("/") || value.includes("\0")) {
    throw new TypeError(`${label} must be an absolute POSIX path without NUL`);
  }
  return resolvePosix("/", value);
}

function validateConfiguredRoot(cwd: string, value: unknown): string {
  if (typeof value !== "string" || value === "" || value.includes("\0")) {
    throw new TypeError("filesystem roots must be non-empty POSIX paths without NUL");
  }
  return resolvePosix(cwd, value);
}

function authorizeRequested(
  cwd: string,
  requested: unknown,
  allowedRoots: readonly string[],
  denyRoots: readonly string[],
): string {
  if (typeof requested !== "string" || requested === "") {
    throw refuse({ reason: "io", detail: "the requested path must be a non-empty string" });
  }
  if (requested.includes("\0")) {
    throw refuse({ reason: "dangerous-path", detail: "the path contains NUL" });
  }
  const target = resolvePosix(cwd, requested);
  authorizeCanonical(target, allowedRoots, denyRoots);
  return target;
}

function authorizeCanonical(
  target: string,
  allowedRoots: readonly string[],
  denyRoots: readonly string[],
): void {
  if (denyRoots.some((root) => containsPosix(root, target))) {
    throw refuse({ reason: "denied", detail: "the path is inside a denied virtual root" });
  }
  if (!allowedRoots.some((root) => containsPosix(root, target))) {
    throw refuse({ reason: "outside-allowed-roots" });
  }
}

async function canonicalPath(
  fs: IFileSystem,
  lexical: string,
  signal?: AbortSignal,
  phase = "realpath",
): Promise<string> {
  const value = await backendCall(() => fs.realpath(lexical), phase, signal);
  if (typeof value !== "string" || value === "" || !value.startsWith("/") || value.includes("\0")) {
    throw invalid("realpath returned an invalid absolute POSIX path", phase);
  }
  return resolvePosix("/", value);
}

function display(cwd: string, target: string): string {
  if (!containsPosix(cwd, target)) return target;
  if (target === cwd) return posixPaths.basename(target) || "/";
  const relative = target.slice(cwd === "/" ? 1 : cwd.length + 1);
  return relative === "" ? posixPaths.basename(target) || "/" : relative;
}

async function inspect(
  fs: IFileSystem,
  method: "stat" | "lstat",
  path: string,
  signal?: AbortSignal,
  phase: string = method,
): Promise<ValidatedStat> {
  const value = await backendCall(() => fs[method](path), phase, signal);
  return validateStat(value, phase);
}

function validateStat(value: FsStat, phase: string): ValidatedStat {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${phase} returned a non-object`, phase);
  }
  const stat = value as unknown as Record<string, unknown>;
  for (const field of ["isFile", "isDirectory", "isSymbolicLink"] as const) {
    if (typeof stat[field] !== "boolean")
      throw invalid(`${phase} returned an invalid ${field}`, phase);
  }
  if ([stat.isFile, stat.isDirectory, stat.isSymbolicLink].filter(Boolean).length > 1) {
    throw invalid(`${phase} returned conflicting entry types`, phase);
  }
  if (!Number.isSafeInteger(stat.size) || (stat.size as number) < 0) {
    throw invalid(`${phase} returned an unusable size`, phase);
  }
  if (!(stat.mtime instanceof Date) || !Number.isFinite(stat.mtime.getTime())) {
    throw invalid(`${phase} returned an unusable modification time`, phase);
  }
  if (
    stat.identity !== undefined &&
    (typeof stat.identity !== "string" ||
      stat.identity === "" ||
      stat.identity.length > MAX_IDENTITY_LENGTH)
  ) {
    throw invalid(`${phase} returned an unusable identity`, phase);
  }
  validateInodePart(stat.dev, "dev", phase);
  validateInodePart(stat.ino, "ino", phase);
  return {
    isFile: stat.isFile as boolean,
    isDirectory: stat.isDirectory as boolean,
    isSymbolicLink: stat.isSymbolicLink as boolean,
    size: stat.size as number,
    mtimeMs: stat.mtime.getTime(),
    ...(typeof stat.identity === "string" ? { identity: stat.identity } : {}),
    ...(typeof stat.dev === "number" || typeof stat.dev === "bigint" ? { dev: stat.dev } : {}),
    ...(typeof stat.ino === "number" || typeof stat.ino === "bigint" ? { ino: stat.ino } : {}),
  };
}

function validateInodePart(value: unknown, field: "dev" | "ino", phase: string): void {
  if (value === undefined) return;
  if (typeof value === "bigint") {
    if (value >= 0n) return;
  } else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return;
  }
  throw invalid(`${phase} returned an unusable ${field}`, phase);
}

function validateDirent(value: unknown): ValidatedDirent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("readdirWithFileTypes returned a non-object entry", "readdirWithFileTypes");
  }
  const entry = value as Record<string, unknown>;
  const name = validateEntryName(entry.name, "readdirWithFileTypes");
  for (const field of ["isFile", "isDirectory", "isSymbolicLink"] as const) {
    if (typeof entry[field] !== "boolean") {
      throw invalid(`readdirWithFileTypes returned an invalid ${field}`, "readdirWithFileTypes");
    }
  }
  const flags = [entry.isFile, entry.isDirectory, entry.isSymbolicLink].filter(Boolean).length;
  if (flags > 1)
    throw invalid("readdirWithFileTypes returned conflicting entry types", "readdirWithFileTypes");
  return {
    name,
    isFile: entry.isFile as boolean,
    isDirectory: entry.isDirectory as boolean,
    isSymbolicLink: entry.isSymbolicLink as boolean,
  };
}

function validateEntryName(value: unknown, phase: string): string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\0")
  ) {
    throw invalid(`${phase} returned an invalid entry name`, phase);
  }
  return value;
}

function directoryEntry(entry: ValidatedDirent): DirectoryEntry {
  return {
    name: entry.name,
    type: entry.isFile ? "file" : entry.isDirectory ? "directory" : "other",
  };
}

function statType(stat: ValidatedStat): DirectoryEntry["type"] {
  return stat.isFile ? "file" : stat.isDirectory ? "directory" : "other";
}

function requireRegularFile(stat: ValidatedStat, cwd: string, resolved: string): void {
  if (stat.isFile) return;
  const error: NotAFileError = {
    reason: "not-a-file",
    kind: stat.isDirectory ? "directory" : "other",
    target: { resolvedPath: resolved, displayPath: display(cwd, resolved) },
  };
  throw refuse(error);
}

function requireWithinCeiling(size: number, ceiling: number, subject: string): void {
  if (size > ceiling) {
    throw refuse({
      reason: "denied",
      detail: `the ${subject} exceeds the ${ceiling}-byte buffered ceiling`,
    });
  }
}

function requireStatKey(stat: ValidatedStat, mode: JustBashIdentityMode): string {
  if (mode === "none") return `weak:${stat.size}:${stat.mtimeMs}`;
  if (stat.identity !== undefined) return `identity:${stat.identity}`;
  if (stat.dev !== undefined && stat.ino !== undefined) {
    return `inode:${String(stat.dev)}:${String(stat.ino)}`;
  }
  throw refuse({
    reason: "unsupported",
    detail: "the backend did not provide stable file identity",
    cause: { code: "IDENTITY_UNAVAILABLE", phase: "stat-key" },
  });
}

function fingerprint(id: string, path: string, key: string, stat: ValidatedStat): string {
  return JSON.stringify([id, path, key, stat.size, stat.mtimeMs]);
}

/* -------------------------------------------------------------------------- */
/* Backend calls and errors                                                   */
/* -------------------------------------------------------------------------- */

async function backendCall<T>(
  operation: () => Promise<T> | T,
  phase: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw refuse({ reason: "aborted", cause: { code: "ABORT_ERR", phase } });
  try {
    const value = await operation();
    if (signal?.aborted) throw refuse({ reason: "aborted", cause: { code: "ABORT_ERR", phase } });
    return value;
  } catch (error) {
    if (error instanceof AdapterRefusal) throw error;
    if (signal?.aborted) throw refuse({ reason: "aborted", cause: { code: "ABORT_ERR", phase } });
    throw refuse(mapBackendError(error, phase));
  }
}

function mapBackendError(error: unknown, phase: string): FileSystemError {
  const code = portableCode(error);
  const cause = { code, phase };
  if (code === "ABORT_ERR") return { reason: "aborted", cause };
  if (code === "ENOENT" || code === "ENOTDIR") return { reason: "not-found", cause };
  /* The call site knows no path, so the target is unknown. */
  if (code === "EISDIR") return { reason: "not-a-file", kind: "directory", target: null, cause };
  if (code === "EACCES") return { reason: "permission-denied", cause };
  if (code === "EPERM" || code === "ELOOP" || code === "EFBIG" || code === "ENAMETOOLONG") {
    return { reason: "denied", cause };
  }
  if (code === "ENOSYS" || code === "ENOTSUP" || code === "EOPNOTSUPP") {
    return { reason: "unsupported", cause };
  }
  return { reason: "io", detail: phase, cause };
}

/** Own `code` first, then a bounded anchored token from message-only errors. */
function portableCode(error: unknown): string {
  if (error !== null && typeof error === "object") {
    try {
      if (Object.prototype.hasOwnProperty.call(error, "code")) {
        const code = (error as { code: unknown }).code;
        if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/u.test(code)) return code;
      }
    } catch {
      /* A hostile accessor is an unknown backend error, never a reason to leak it. */
    }
  }
  try {
    if (error instanceof Error) {
      const message = typeof error.message === "string" ? error.message.slice(0, 64) : "";
      const match = /^(E[A-Z]{2,12}):/u.exec(message);
      if (match?.[1] !== undefined) return match[1];
      if (error.name === "AbortError") return "ABORT_ERR";
    }
  } catch {
    /* Error subclasses and proxies do not get to make error mapping throw. */
  }
  return "UNKNOWN";
}

class AdapterRefusal extends Error {
  constructor(readonly error: FileSystemError) {
    super(error.reason);
    this.name = "AdapterRefusal";
  }
}

function refuse(error: FileSystemError): AdapterRefusal {
  return new AdapterRefusal(error);
}

function invalid(detail: string, phase: string): AdapterRefusal {
  return new AdapterRefusal({
    reason: "io",
    detail,
    cause: { code: "INVALID_BACKEND_RESULT", phase },
  });
}

function toFileSystemError(error: unknown): FileSystemError {
  if (error instanceof AdapterRefusal) return error.error;
  return {
    reason: "io",
    detail: "the just-bash adapter failed",
    cause: { code: portableCode(error) },
  };
}
