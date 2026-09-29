/**
 * Path policy, backend value checks and error mapping shared by reads and
 * writes. Every backend failure is mapped here, once.
 */
import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type {
  DirectoryEntry,
  FileSystemError,
  FileSystemRootOptions,
  NotAFileError,
} from "@better-fs-tools/fs";

import type { CloudflareComputerFileSystemLike, CloudflareComputerStat } from "./contract.ts";

/** The resolved roots. Every path is absolute and normalized. */
export interface Roots {
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly denyRoots: readonly string[];
}

/**
 * The shared root options, checked. Relative roots resolve against `cwd`, or
 * against `/` when there is no `cwd`. `cwd` defaults to the first allowed
 * root, so one root doubles as the working directory.
 */
export function resolveRoots(options: FileSystemRootOptions<"reject", "none">): Roots {
  const base = options.cwd === undefined ? "/" : absolutePath(options.cwd, "cwd");
  const allowed = options.allowedRoots;
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new TypeError("allowedRoots must be a non-empty array");
  }
  const allowedRoots = Object.freeze(allowed.map((root) => configuredRoot(base, root)));
  if (options.denyRoots !== undefined && !Array.isArray(options.denyRoots)) {
    throw new TypeError("denyRoots must be an array");
  }
  const denyRoots = Object.freeze(
    (options.denyRoots ?? []).map((root) => configuredRoot(base, root)),
  );
  if (options.symlinks !== undefined && options.symlinks !== "reject") {
    throw new TypeError('symlinks must be "reject": this adapter refuses every symbolic link');
  }
  if (options.identity !== undefined && options.identity !== "none") {
    throw new TypeError('identity must be "none": a Computer inode is not a stable identity');
  }
  return { cwd: options.cwd === undefined ? allowedRoots[0]! : base, allowedRoots, denyRoots };
}

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0")) {
    throw new TypeError(`${label} must be an absolute POSIX path without NUL`);
  }
  return resolvePosix("/", value);
}

function configuredRoot(base: string, value: unknown): string {
  if (typeof value !== "string" || value === "" || value.includes("\0")) {
    throw new TypeError("filesystem roots must be non-empty POSIX paths without NUL");
  }
  return resolvePosix(base, value);
}

/* -------------------------------------------------------------------------- */
/* Namespace policy                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every component of `target` from `/` down, ending at the target. The walk
 * starts at `/`, not at the allowed root, so `symlinks: "reject"` also covers
 * the ancestors of the root.
 */
export function components(target: string): string[] {
  const found: string[] = [];
  let current = "";
  for (const segment of target.split("/")) {
    if (segment === "") continue;
    current = `${current}/${segment}`;
    found.push(current);
  }
  return found;
}

/**
 * Lexical containment, before the backend is touched at all. A relative path
 * is resolved against `cwd`, so a Worker prompt can use either form, and `..`
 * is folded by the resolver before the check rather than after it. Returns the
 * target and the innermost allowed root that holds it.
 */
export function authorize(
  roots: Roots,
  requested: unknown,
): { readonly root: string; readonly target: string } {
  if (typeof requested !== "string" || requested === "") {
    throw refuse({ reason: "io", detail: "the requested path must be a non-empty string" });
  }
  if (requested.includes("\0")) {
    throw refuse({ reason: "dangerous-path", detail: "the path contains NUL" });
  }
  const target = resolvePosix(roots.cwd, requested);
  // A deny root is dangerous-path in every adapter, with the root as the detail.
  const denied = roots.denyRoots.find((root) => containsPosix(root, target));
  if (denied !== undefined) throw refuse({ reason: "dangerous-path", detail: denied });
  let root: string | null = null;
  for (const candidate of roots.allowedRoots) {
    if (containsPosix(candidate, target) && (root === null || candidate.length > root.length)) {
      root = candidate;
    }
  }
  if (root === null) throw refuse({ reason: "outside-allowed-roots" });
  return { root, target };
}

/** Relative to `cwd`. `cwd` itself shows its own name, or "/". Outside `cwd`, the absolute path. */
export function display(cwd: string, target: string): string {
  if (!containsPosix(cwd, target)) return target;
  if (target === cwd) return posixPaths.basename(target) || "/";
  return target.slice(cwd === "/" ? 1 : cwd.length + 1);
}

export function notAFile(kind: NotAFileError["kind"], cwd: string, target: string): NotAFileError {
  return {
    reason: "not-a-file",
    kind,
    target: { resolvedPath: target, displayPath: display(cwd, target) },
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
export async function inspect(
  workspaceFs: CloudflareComputerFileSystemLike,
  method: "stat" | "lstat",
  path: string,
  intermediate: boolean,
): Promise<CloudflareComputerStat> {
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

export function validateStat(value: unknown, path: string, phase: string): CloudflareComputerStat {
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
  /* Only writes use the mode. An unusable one is dropped, not refused, so reads keep working. */
  const mode =
    Number.isSafeInteger(entry.mode) && (entry.mode as number) >= 0
      ? (entry.mode as number) & 0o7777
      : undefined;
  return {
    name: entry.name,
    size: entry.size as number,
    mtime: entry.mtime,
    isFile,
    isDirectory,
    isSymbolicLink,
    ...(mode === undefined ? {} : { mode }),
  };
}

export function validateDirent(value: unknown, parent: string): DirectoryEntry {
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
export function typeFlags(
  entry: Record<string, unknown>,
  phase: string,
): [boolean, boolean, boolean] {
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

export function validateStream(value: unknown): asserts value is ReadableStream<Uint8Array> {
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
export function cancel(stream: ReadableStream<Uint8Array>): void {
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
export async function call<T>(pending: Promise<T> | T, phase: string): Promise<T> {
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
export function mapBackendError(error: unknown, phase: string): FileSystemError {
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
export function boundedCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/u.test(code)) return code;
  }
  if (error instanceof Error && error.name === "AbortError") return "ABORT_ERR";
  return "UNKNOWN";
}

/** Carries a typed error out of a helper. Never escapes this module. */
export class AdapterRefusal extends Error {
  constructor(readonly error: FileSystemError) {
    super(error.reason);
    this.name = "AdapterRefusal";
  }
}

export function refuse(error: FileSystemError): AdapterRefusal {
  return new AdapterRefusal(error);
}

export function invalid(detail: string, phase: string): AdapterRefusal {
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
export function toFileSystemError(error: unknown): FileSystemError {
  if (error instanceof AdapterRefusal) return error.error;
  return {
    reason: "io",
    detail: "the Cloudflare Computer filesystem adapter failed",
    cause: { code: boundedCode(error) },
  };
}

/**
 * Only the read methods are checked here (decision W4). The write methods are
 * optional and checked when a write runs, so a read-only wrapper can back a
 * read tool.
 */
export function validateFileSystem(workspaceFs: CloudflareComputerFileSystemLike): void {
  if (workspaceFs === null || typeof workspaceFs !== "object" || Array.isArray(workspaceFs)) {
    throw new TypeError(
      "cloudflareComputerFileSystem needs a Cloudflare Computer workspace filesystem",
    );
  }
  const methods = ["readFile", "stat", "lstat", "readdir"] as const;
  for (const method of methods) {
    if (typeof workspaceFs[method] !== "function") {
      throw new TypeError(`the Computer workspace filesystem must implement ${method}()`);
    }
  }
}
