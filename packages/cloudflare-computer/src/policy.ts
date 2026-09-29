import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type {
  DirectoryEntry,
  FileSystemError,
  FileSystemRootOptions,
  NotAFileError,
} from "@better-fs-tools/fs";

import type { CloudflareComputerFileSystemLike, CloudflareComputerStat } from "./contract.ts";

export interface Roots {
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly denyRoots: readonly string[];
}

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

export function pathsFromSlashToTarget(target: string): string[] {
  const found: string[] = [];
  let current = "";
  for (const segment of target.split("/")) {
    if (segment === "") continue;
    current = `${current}/${segment}`;
    found.push(current);
  }
  return found;
}

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
  const denied = roots.denyRoots.find((root) => containsPosix(root, target));
  if (denied !== undefined) throw refuse({ reason: "dangerous-path", detail: denied });
  const innermostRoot = innermostAllowedRoot(roots, target);
  if (innermostRoot === null) throw refuse({ reason: "outside-allowed-roots" });
  return { root: innermostRoot, target };
}

function innermostAllowedRoot(roots: Roots, target: string): string | null {
  let root: string | null = null;
  for (const candidate of roots.allowedRoots) {
    if (containsPosix(candidate, target) && (root === null || candidate.length > root.length)) {
      root = candidate;
    }
  }
  return root;
}

export function displayPath(cwd: string, target: string): string {
  if (!containsPosix(cwd, target)) return target;
  if (target === cwd) return posixPaths.basename(target) || "/";
  return target.slice(cwd === "/" ? 1 : cwd.length + 1);
}

export function notAFile(kind: NotAFileError["kind"], cwd: string, target: string): NotAFileError {
  return {
    reason: "not-a-file",
    kind,
    target: { resolvedPath: target, displayPath: displayPath(cwd, target) },
  };
}

export async function inspect(
  workspaceFs: CloudflareComputerFileSystemLike,
  method: "stat" | "lstat",
  path: string,
  isAncestorComponent: boolean,
): Promise<CloudflareComputerStat> {
  let value: unknown;
  try {
    value = await call(workspaceFs[method](path), method);
  } catch (error) {
    if (
      isAncestorComponent &&
      error instanceof AdapterRefusal &&
      error.error.reason === "not-found"
    ) {
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
  /* Computer's name for the root "/" is unconfirmed, so it is not compared. */
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
  /* An unusable mode is dropped, not refused, so reads keep working. */
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

export function cancelWithoutWaiting(stream: ReadableStream<Uint8Array>): void {
  try {
    void Promise.resolve(stream.cancel()).catch(() => {});
  } catch {
    /* Best effort. */
  }
}

export async function call<T>(pending: Promise<T> | T, phase: string): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof AdapterRefusal) throw error;
    throw refuse(mapBackendError(error, phase));
  }
}

export function mapBackendError(error: unknown, phase: string): FileSystemError {
  const code = boundedCode(error);
  const cause = { code, phase };
  if (code === "ABORT_ERR") return { reason: "aborted", cause };
  if (code === "ENOENT" || code === "ENOTDIR") return { reason: "not-found", cause };
  if (code === "EISDIR") return { reason: "not-a-file", kind: "directory", target: null, cause };
  if (code === "EACCES" || code === "EPERM") return { reason: "permission-denied", cause };
  if (code === "ELOOP") return { reason: "denied", detail: "too many symbolic links", cause };
  if (code === "EINVAL") {
    return { reason: "dangerous-path", detail: "the backend rejected the path", cause };
  }
  return { reason: "io", detail: phase, cause };
}

export function boundedCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/u.test(code)) return code;
  }
  if (error instanceof Error && error.name === "AbortError") return "ABORT_ERR";
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
    detail: "the Cloudflare Computer filesystem adapter failed",
    cause: { code: boundedCode(error) },
  };
}

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
