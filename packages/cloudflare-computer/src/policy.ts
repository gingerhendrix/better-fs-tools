/**
 * Path policy, backend value checks and error mapping shared by reads and
 * writes. Every backend failure is mapped here, once.
 */
import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type { DirectoryEntry, FileSystemError, NotAFileError } from "@better-fs-tools/fs";

import type { ComputerFileSystemLike, ComputerStat } from "./contract.ts";

/* -------------------------------------------------------------------------- */
/* Namespace policy                                                           */
/* -------------------------------------------------------------------------- */

/** Root, then every component beneath it, ending at the target. */
export function components(root: string, target: string): string[] {
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
export function authorize(root: string, requested: unknown): string {
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
export function display(root: string, target: string): string {
  if (target === root) return posixPaths.basename(target) || "/";
  return target.slice(root === "/" ? 1 : root.length + 1);
}

export function notAFile(kind: NotAFileError["kind"], root: string, target: string): NotAFileError {
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
export async function inspect(
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

export function validateStat(value: unknown, path: string, phase: string): ComputerStat {
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

export function validateFileSystem(workspaceFs: ComputerFileSystemLike): void {
  if (workspaceFs === null || typeof workspaceFs !== "object" || Array.isArray(workspaceFs)) {
    throw new TypeError("computerFileSystem needs a Cloudflare Computer workspace filesystem");
  }
  const methods = ["readFile", "stat", "lstat", "readdir", "writeFile", "mkdir", "rm"] as const;
  for (const method of methods) {
    if (typeof workspaceFs[method] !== "function") {
      throw new TypeError(`the Computer workspace filesystem must implement ${method}()`);
    }
  }
}
