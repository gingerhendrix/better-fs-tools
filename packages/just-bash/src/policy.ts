/**
 * Path policy, backend value checks and error mapping shared by reads and
 * writes. Raw backend messages, which can contain paths, never leave here.
 */
import type { FsStat, IFileSystem } from "just-bash";

import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type { DirectoryEntry, FileSystemError, NotAFileError } from "@better-fs-tools/fs";

import type {
  JustBashIdentityMode,
  JustBashReadFileSystemOptions,
  JustBashSymlinkPolicy,
} from "./contract.ts";

const MAX_IDENTITY_LENGTH = 1_024;

export interface ValidatedStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly size: number;
  readonly mtimeMs: number;
  readonly identity?: string;
  readonly dev?: number | bigint;
  readonly ino?: number | bigint;
  /** Permission bits. Only writes use them. */
  readonly mode?: number;
}

export interface ValidatedDirent {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
}

/* -------------------------------------------------------------------------- */
/* Policy and validation                                                      */
/* -------------------------------------------------------------------------- */

/** Validated options, shared by the read and write halves. */
export interface JustBashSettings {
  readonly id: string;
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly denyRoots: readonly string[];
  readonly maxBufferedBytes: number;
  readonly identityMode: JustBashIdentityMode;
  readonly symlinkPolicy: JustBashSymlinkPolicy;
}

export function validateOptions(options: JustBashReadFileSystemOptions): JustBashSettings {
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

/** `extra` names the methods writes need on top of the read methods. */
export function validateFileSystem(
  fs: IFileSystem,
  extra: readonly (keyof IFileSystem)[] = [],
): void {
  if (fs === null || typeof fs !== "object" || Array.isArray(fs)) {
    throw new TypeError("justBashReadFileSystem needs an IFileSystem object");
  }
  const read = ["lstat", "realpath", "stat", "readFileBuffer", "readdir"] as const;
  for (const method of [...read, ...extra]) {
    if (typeof fs[method] !== "function")
      throw new TypeError(`the IFileSystem must implement ${method}()`);
  }
  if (fs.readdirWithFileTypes !== undefined && typeof fs.readdirWithFileTypes !== "function") {
    throw new TypeError("IFileSystem readdirWithFileTypes must be a function when present");
  }
}

export function validateAbsolutePath(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "" || !value.startsWith("/") || value.includes("\0")) {
    throw new TypeError(`${label} must be an absolute POSIX path without NUL`);
  }
  return resolvePosix("/", value);
}

export function validateConfiguredRoot(cwd: string, value: unknown): string {
  if (typeof value !== "string" || value === "" || value.includes("\0")) {
    throw new TypeError("filesystem roots must be non-empty POSIX paths without NUL");
  }
  return resolvePosix(cwd, value);
}

export function authorizeRequested(
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

export function authorizeCanonical(
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

export async function canonicalPath(
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

export function display(cwd: string, target: string): string {
  if (!containsPosix(cwd, target)) return target;
  if (target === cwd) return posixPaths.basename(target) || "/";
  const relative = target.slice(cwd === "/" ? 1 : cwd.length + 1);
  return relative === "" ? posixPaths.basename(target) || "/" : relative;
}

export async function inspect(
  fs: IFileSystem,
  method: "stat" | "lstat",
  path: string,
  signal?: AbortSignal,
  phase: string = method,
): Promise<ValidatedStat> {
  const value = await backendCall(() => fs[method](path), phase, signal);
  return validateStat(value, phase);
}

export function validateStat(value: FsStat, phase: string): ValidatedStat {
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
    /* An unusable mode is dropped, not refused, so reads keep working. */
    ...(Number.isSafeInteger(stat.mode) && (stat.mode as number) >= 0
      ? { mode: (stat.mode as number) & 0o7777 }
      : {}),
  };
}

export function validateInodePart(value: unknown, field: "dev" | "ino", phase: string): void {
  if (value === undefined) return;
  if (typeof value === "bigint") {
    if (value >= 0n) return;
  } else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return;
  }
  throw invalid(`${phase} returned an unusable ${field}`, phase);
}

export function validateDirent(value: unknown): ValidatedDirent {
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

export function validateEntryName(value: unknown, phase: string): string {
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

export function directoryEntry(entry: ValidatedDirent): DirectoryEntry {
  return {
    name: entry.name,
    type: entry.isFile ? "file" : entry.isDirectory ? "directory" : "other",
  };
}

export function statType(stat: ValidatedStat): DirectoryEntry["type"] {
  return stat.isFile ? "file" : stat.isDirectory ? "directory" : "other";
}

export function requireRegularFile(stat: ValidatedStat, cwd: string, resolved: string): void {
  if (stat.isFile) return;
  const error: NotAFileError = {
    reason: "not-a-file",
    kind: stat.isDirectory ? "directory" : "other",
    target: { resolvedPath: resolved, displayPath: display(cwd, resolved) },
  };
  throw refuse(error);
}

export function requireWithinCeiling(size: number, ceiling: number, subject: string): void {
  if (size > ceiling) {
    throw refuse({
      reason: "too-large",
      limit: ceiling,
      size,
      detail: `the ${subject} exceeds the ${ceiling}-byte buffered ceiling`,
    });
  }
}

export function requireStatKey(stat: ValidatedStat, mode: JustBashIdentityMode): string {
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

export function fingerprint(id: string, path: string, key: string, stat: ValidatedStat): string {
  return JSON.stringify([id, path, key, stat.size, stat.mtimeMs]);
}

/* -------------------------------------------------------------------------- */
/* Backend calls and errors                                                   */
/* -------------------------------------------------------------------------- */

export async function backendCall<T>(
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

export function mapBackendError(error: unknown, phase: string): FileSystemError {
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
export function portableCode(error: unknown): string {
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

export function toFileSystemError(error: unknown): FileSystemError {
  if (error instanceof AdapterRefusal) return error.error;
  return {
    reason: "io",
    detail: "the just-bash adapter failed",
    cause: { code: portableCode(error) },
  };
}
