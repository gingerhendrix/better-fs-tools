/**
 * **Experimental.** Cloudflare Computer's workspace filesystem as a
 * `FileSystem`.
 *
 * `@cloudflare/computer` is preview software: its `WorkspaceFilesystem` surface
 * carries no stability guarantee, and this adapter is pinned to `0.2.1`. Treat
 * this package the same way: it can change with the upstream package.
 *
 * Nothing from `@cloudflare/computer` is imported here. The filesystem surface
 * the adapter needs is declared structurally below, so the package stays
 * importable in a Worker on a different Computer release, and so no Node
 * builtin can reach the Worker graph. Both the local `WorkspaceFilesystem` and
 * the RPC `WorkspaceFilesystemStub` satisfy it; the tests assert that against
 * the real declarations.
 *
 * Two Computer properties shape the whole adapter, and both are the mirror
 * image of the Shell adapter:
 *
 * - **Reads stream.** `readFile(path)` (the single-argument, no-encoding
 *   overload, the only one this adapter ever calls) resolves with a Web
 *   `ReadableStream<Uint8Array>`. `bytes()` exposes its chunks through one
 *   single-use async iterator and never buffers the object, so
 *   `capabilities.streaming` is true and no allocation ceiling is needed.
 *   `close()` cancels the stream, which is what makes an aborted or
 *   scan-capped read stop costing anything.
 * - **Identity is weak.** A `WorkspaceStatResult` does carry an `inode`, but
 *   it is a preview durable-object row rather than a durable identity claim, so
 *   `capabilities.identity` is false, `info.identity` is null, and `verify()`
 *   is mutation detection over type, size and modification time.
 *
 * Policy is adapter-owned and fails closed. Containment is checked lexically
 * before the backend is touched at all, and every path component from the
 * configured root to the target is `lstat`ed and refused if it is a symbolic
 * link. So a symlinked root, parent or leaf, a dangling link and a looping
 * link are all refused before `stat`, `readFile` or `readdir` can run.
 */
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

/**
 * One entry as Computer's `stat`/`lstat` describe it. A structural subset of
 * `WorkspaceStatResult`: the fields this adapter reads are declared, `inode`
 * and `mode` are deliberately ignored, and everything here is validated at
 * runtime anyway.
 */
export interface ComputerStat {
  name: string;
  /** Epoch milliseconds. */
  mtime: number;
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

/** A structural subset of Computer's `WorkspaceDirentResult`. */
export interface ComputerDirent {
  name: string;
  parentPath: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

/**
 * The filesystem methods this adapter uses. `WorkspaceFilesystem` and
 * `WorkspaceFilesystemStub` from `@cloudflare/computer@0.2.1` both satisfy it.
 *
 * `readFile` is declared with one parameter on purpose. Supplying an encoding
 * or a byte window selects a different upstream overload, and this adapter must
 * only ever take the whole-object stream: the core owns windowing, and a string
 * overload would bypass byte classification entirely.
 */
export interface ComputerFileSystemLike {
  readFile(path: string): Promise<ReadableStream<Uint8Array>>;
  stat(path: string): Promise<ComputerStat>;
  lstat(path: string): Promise<ComputerStat>;
  readdir(path: string, options?: { limit?: number; offset?: number }): Promise<ComputerDirent[]>;
}

export interface ComputerFileSystemOptions {
  /** Absolute POSIX path. Nothing outside it is readable or listable. */
  root: string;
  id?: string;
}

export interface ComputerFileSystem extends FileSystem {
  readonly root: string;
  list(path: string, options: ListOptions): Promise<ListOutcome>;
}

/**
 * Adapt a Cloudflare Computer workspace filesystem to the filesystem contract.
 *
 * @experimental Cloudflare Computer is preview software and this adapter is
 * pinned to the `0.2.1` declarations.
 */
export function computerFileSystem(
  workspaceFs: ComputerFileSystemLike,
  options: ComputerFileSystemOptions,
): ComputerFileSystem {
  validateFileSystem(workspaceFs);
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("computerFileSystem options must be an object");
  }
  if (
    typeof options.root !== "string" ||
    !options.root.startsWith("/") ||
    options.root.includes("\0")
  ) {
    throw new TypeError("root must be an absolute POSIX path without NUL");
  }
  const root = resolvePosix("/", options.root);

  /** Refuse a symlinked root, a symlinked parent and a symlinked leaf. */
  const walk = async (target: string): Promise<ComputerStat> => {
    for (const component of components(root, target)) {
      const stat = await inspect(workspaceFs, "lstat", component, component !== target);
      if (stat.isSymbolicLink) {
        throw refuse({
          reason: "denied",
          detail:
            component === target
              ? "the path is a symbolic link and this adapter refuses symlinks"
              : "a path component is a symbolic link and this adapter refuses symlinks",
        });
      }
      if (component !== target && !stat.isDirectory) {
        throw refuse({ reason: "not-found", detail: "a path component is not a directory" });
      }
      if (component === target) return stat;
    }
    /* Only reachable when the target is the root "/" itself, which is a directory. */
    throw refuse(notAFile("directory", root, target));
  };

  return Object.freeze({
    id: options.id ?? "cloudflare-computer",
    capabilities: Object.freeze({ streaming: true, identity: false }),
    paths: posixPaths,
    root,

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      const signal = callOptions.signal;
      if (signal?.aborted) return { ok: false, error: { reason: "aborted" } };

      try {
        const target = authorize(root, requested);
        await walk(target);

        /* `stat` follows links, but `walk` has already refused every one. */
        const stat = await inspect(workspaceFs, "stat", target, false);
        if (!stat.isFile) {
          throw refuse(notAFile(stat.isDirectory ? "directory" : "other", root, target));
        }

        if (signal?.aborted) throw refuse({ reason: "aborted" });
        /* Exactly one argument. Any other overload buffers or returns a string. */
        const stream = await call(workspaceFs.readFile(target), "readFile");
        validateStream(stream);
        if (signal?.aborted) {
          cancel(stream);
          throw refuse({ reason: "aborted" });
        }
        return { ok: true, file: computerOpenFile(workspaceFs, root, target, stat, stream) };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },

    async list(requested: string, listOptions: ListOptions): Promise<ListOutcome> {
      if (listOptions.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      const limit = listOptions.limit;
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        return {
          ok: false,
          error: { reason: "io", detail: "list limit must be a positive safe integer" },
        };
      }
      try {
        const target = authorize(root, requested);
        /* A root of "/" has no component for walk() to inspect, and it is a directory. */
        const stat = target === "/" ? null : await walk(target);
        /* Same rule as memoryFileSystem: listing a non-directory is not-found. */
        if (stat !== null && !stat.isDirectory) {
          throw refuse({ reason: "not-found", detail: "not a directory" });
        }

        /* One more than asked for, so `truncated` is observed rather than guessed. */
        const listed = await call(
          workspaceFs.readdir(target, { limit: limit + 1, offset: 0 }),
          "readdir",
        );
        if (!Array.isArray(listed)) throw invalid("readdir returned a non-array", "readdir");

        const entries: DirectoryEntry[] = [];
        for (const value of listed.slice(0, limit)) {
          entries.push(validateDirent(value, target));
        }
        return { ok: true, entries, truncated: listed.length > limit };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The handle                                                                 */
/* -------------------------------------------------------------------------- */

function computerOpenFile(
  workspaceFs: ComputerFileSystemLike,
  root: string,
  target: string,
  stat: ComputerStat,
  stream: ReadableStream<Uint8Array>,
): OpenFile {
  let consumed = false;
  let closed = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  /**
   * Request cancellation and drop the reader.
   *
   * The cancel promise is deliberately **not** awaited. `close()` runs from the
   * core's `finally` and is awaited there, so a backend whose `cancel()` never
   * settles (a plausible failure for an RPC stub whose peer has gone away)
   * would otherwise hang the whole read after it had already produced its
   * result. Cancellation is still requested, and every rejection is
   * swallowed, including a reader that throws synchronously.
   */
  const release = (): void => {
    closed = true;
    const held = reader;
    reader = null;
    try {
      if (held === null) {
        void Promise.resolve(stream.cancel()).catch(() => {});
        return;
      }
      void Promise.resolve(held.cancel()).catch(() => {});
      /* Best effort: a spec-compliant reader releases on cancel, a stub may not. */
      try {
        held.releaseLock();
      } catch {
        /* Ignored: the lock no longer matters once the handle is closed. */
      }
    } catch {
      /* Ignored: cancellation is best effort. */
    }
  };

  return {
    info: {
      resolvedPath: target,
      displayPath: display(root, target),
      size: stat.size,
      mtimeMs: stat.mtime,
      identity: null,
      mimeType: null,
    },
    bytes(): AsyncIterable<Uint8Array> {
      if (consumed) throw new TypeError("cloudflare computer byte source is single-use");
      consumed = true;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<Uint8Array>> {
              if (closed) return { done: true, value: undefined };
              const active = reader ?? (reader = acquire(stream));
              const item = await active.read();
              if (item === null || typeof item !== "object" || typeof item.done !== "boolean") {
                throw new TypeError("Cloudflare Computer's reader returned an invalid result");
              }
              if (item.done) {
                release();
                return { done: true, value: undefined };
              }
              if (!(item.value instanceof Uint8Array)) {
                throw new TypeError("Cloudflare Computer's stream yielded a non-Uint8Array chunk");
              }
              return { done: false, value: item.value };
            },
            async return(): Promise<IteratorResult<Uint8Array>> {
              release();
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    async verify(): Promise<VerifyOutcome> {
      try {
        const current = await inspect(workspaceFs, "lstat", target, false);
        const changed =
          current.isFile !== stat.isFile ||
          current.isDirectory !== stat.isDirectory ||
          current.isSymbolicLink !== stat.isSymbolicLink ||
          current.size !== stat.size ||
          current.mtime !== stat.mtime;
        return { ok: true, changed };
      } catch (error) {
        const mapped = toFileSystemError(error);
        /* A file that has been removed has changed; it is not a failed check. */
        if (mapped.reason === "not-found") return { ok: true, changed: true };
        return { ok: false, error: mapped };
      }
    },
    async close(): Promise<void> {
      consumed = true;
      if (closed) return;
      release();
    },
  };
}

/**
 * `getReader()` on a backend value that passed the stream shape check but may
 * still not behave like one. Failures here surface from `bytes()` rather than
 * from `open()`, so they are plain `TypeError`s: the core turns a throwing byte
 * source into `IO_ERROR` and still calls `close()`.
 */
function acquire(stream: ReadableStream<Uint8Array>): ReadableStreamDefaultReader<Uint8Array> {
  const reader: unknown = stream.getReader();
  if (
    reader === null ||
    typeof reader !== "object" ||
    typeof (reader as { read?: unknown }).read !== "function" ||
    typeof (reader as { cancel?: unknown }).cancel !== "function"
  ) {
    throw new TypeError("Cloudflare Computer's stream returned an unusable reader");
  }
  return reader as ReadableStreamDefaultReader<Uint8Array>;
}

/* -------------------------------------------------------------------------- */
/* Namespace policy                                                           */
/* -------------------------------------------------------------------------- */

/** Root, then every component beneath it, ending at the target. */
function components(root: string, target: string): string[] {
  const found: string[] = root === "/" ? [] : [root];
  const relative = target === root ? "" : target.slice(root === "/" ? 1 : root.length + 1);
  let current = root;
  for (const segment of relative.split("/")) {
    if (segment === "") continue;
    current = current === "/" ? `/${segment}` : `${current}/${segment}`;
    found.push(current);
  }
  return found;
}

/**
 * Lexical containment, before the backend is touched at all. A relative path is
 * resolved against the root, so a Worker prompt can use either form, and `..`
 * is folded by the resolver before the check rather than after it.
 */
function authorize(root: string, requested: unknown): string {
  if (typeof requested !== "string" || requested === "") {
    throw refuse({ reason: "io", detail: "the requested path must be a non-empty string" });
  }
  if (requested.includes("\0")) {
    throw refuse({ reason: "dangerous-path", detail: "the path contains NUL" });
  }
  const target = resolvePosix(root, requested);
  if (!containsPosix(root, target)) throw refuse({ reason: "outside-allowed-roots" });
  return target;
}

/** Relative to the root. The root itself shows its own name, or "/". */
function display(root: string, target: string): string {
  if (target === root) return posixPaths.basename(target) || "/";
  return target.slice(root === "/" ? 1 : root.length + 1);
}

function notAFile(kind: NotAFileError["kind"], root: string, target: string): NotAFileError {
  return {
    reason: "not-a-file",
    kind,
    target: { resolvedPath: target, displayPath: display(root, target) },
  };
}

/* -------------------------------------------------------------------------- */
/* Backend values                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One `stat` or `lstat` call, validated. Unlike Shell, Computer signals a miss
 * by throwing `ENOENT` rather than resolving null, so `intermediate` decides
 * whether a miss is described as a missing component.
 */
async function inspect(
  workspaceFs: ComputerFileSystemLike,
  method: "stat" | "lstat",
  path: string,
  intermediate: boolean,
): Promise<ComputerStat> {
  let value: unknown;
  try {
    value = await call(workspaceFs[method](path), method);
  } catch (error) {
    if (intermediate && error instanceof AdapterRefusal && error.error.reason === "not-found") {
      throw refuse({ ...error.error, detail: "a path component does not exist" });
    }
    throw error;
  }
  return validateStat(value, path, method);
}

function validateStat(value: unknown, path: string, phase: string): ComputerStat {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${phase} did not return an entry`, phase);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.name !== "string" || entry.name === "" || entry.name.includes("\0")) {
    throw invalid(`${phase} returned an entry without a usable name`, phase);
  }
  /* Computer's rendering of the root's own name is unconfirmed, so it is the
     one component whose name is not compared. Every other one must match. */
  const expected = path === "/" ? null : posixPaths.basename(path);
  if (expected !== null && entry.name !== expected) {
    throw invalid(`${phase} returned an entry for a different path`, phase);
  }
  if (!Number.isSafeInteger(entry.size) || (entry.size as number) < 0) {
    throw invalid(`${phase} returned an unusable size`, phase);
  }
  if (typeof entry.mtime !== "number" || !Number.isFinite(entry.mtime)) {
    throw invalid(`${phase} returned an unusable modification time`, phase);
  }
  const [isFile, isDirectory, isSymbolicLink] = typeFlags(entry, phase);
  return {
    name: entry.name,
    size: entry.size as number,
    mtime: entry.mtime,
    isFile,
    isDirectory,
    isSymbolicLink,
  };
}

function validateDirent(value: unknown, parent: string): DirectoryEntry {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("readdir returned an entry that is not an object", "readdir");
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.parentPath !== "string" || resolvePosix("/", entry.parentPath) !== parent) {
    throw invalid("readdir returned an entry outside the listed directory", "readdir");
  }
  const name = entry.name;
  if (
    typeof name !== "string" ||
    name === "" ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\0")
  ) {
    throw invalid("readdir returned an entry without a usable name", "readdir");
  }
  const [isFile, isDirectory] = typeFlags(entry, "readdir");
  return { name, type: isFile ? "file" : isDirectory ? "directory" : "other" };
}

/** Exactly one of the three flags. Anything else is a malformed backend value. */
function typeFlags(entry: Record<string, unknown>, phase: string): [boolean, boolean, boolean] {
  for (const flag of ["isFile", "isDirectory", "isSymbolicLink"] as const) {
    if (typeof entry[flag] !== "boolean") {
      throw invalid(`${phase} returned an unusable ${flag} flag`, phase);
    }
  }
  const flags: [boolean, boolean, boolean] = [
    entry.isFile as boolean,
    entry.isDirectory as boolean,
    entry.isSymbolicLink as boolean,
  ];
  if (flags.filter(Boolean).length !== 1) {
    throw invalid(`${phase} did not identify exactly one entry type`, phase);
  }
  return flags;
}

function validateStream(value: unknown): asserts value is ReadableStream<Uint8Array> {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as { getReader?: unknown }).getReader !== "function" ||
    typeof (value as { cancel?: unknown }).cancel !== "function"
  ) {
    throw invalid("readFile did not return a ReadableStream", "readFile");
  }
}

/** Fire-and-forget cancellation of a stream that was never handed out. */
function cancel(stream: ReadableStream<Uint8Array>): void {
  try {
    void Promise.resolve(stream.cancel()).catch(() => {});
  } catch {
    /* Ignored: cancellation is best effort. */
  }
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Await one backend call, mapping whatever it throws exactly once. */
async function call<T>(pending: Promise<T> | T, phase: string): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof AdapterRefusal) throw error;
    throw refuse(mapBackendError(error, phase));
  }
}

/**
 * Computer's durable-object filesystem raises `WorkspaceFsError` with a
 * POSIX-shaped `code`. They are mapped once, here, into the reason vocabulary,
 * keeping a bounded code and the phase for diagnostics and dropping the
 * message.
 */
function mapBackendError(error: unknown, phase: string): FileSystemError {
  const code = boundedCode(error);
  const cause = { code, phase };
  if (code === "ABORT_ERR") return { reason: "aborted", cause };
  if (code === "ENOENT" || code === "ENOTDIR") return { reason: "not-found", cause };
  /* The call site knows no path, so the target is unknown. */
  if (code === "EISDIR") return { reason: "not-a-file", kind: "directory", target: null, cause };
  if (code === "EACCES" || code === "EPERM") return { reason: "permission-denied", cause };
  if (code === "ELOOP") return { reason: "denied", detail: "too many symbolic links", cause };
  if (code === "EINVAL") {
    return { reason: "dangerous-path", detail: "the backend rejected the path", cause };
  }
  return { reason: "io", detail: phase, cause };
}

/** A short, allocation-bounded token. Never the backend's message. */
function boundedCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/u.test(code)) return code;
  }
  if (error instanceof Error && error.name === "AbortError") return "ABORT_ERR";
  return "UNKNOWN";
}

/** Carries a typed error out of a helper. Never escapes this module. */
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

/**
 * `open()` and `list()` return errors, never throw, so an unexpected throw from
 * anywhere below becomes a bounded `io` error rather than escaping the adapter.
 */
function toFileSystemError(error: unknown): FileSystemError {
  if (error instanceof AdapterRefusal) return error.error;
  return {
    reason: "io",
    detail: "the Cloudflare Computer filesystem adapter failed",
    cause: { code: boundedCode(error) },
  };
}

function validateFileSystem(workspaceFs: ComputerFileSystemLike): void {
  if (workspaceFs === null || typeof workspaceFs !== "object" || Array.isArray(workspaceFs)) {
    throw new TypeError("computerFileSystem needs a Cloudflare Computer workspace filesystem");
  }
  for (const method of ["readFile", "stat", "lstat", "readdir"] as const) {
    if (typeof workspaceFs[method] !== "function") {
      throw new TypeError(`the Computer workspace filesystem must implement ${method}()`);
    }
  }
}
