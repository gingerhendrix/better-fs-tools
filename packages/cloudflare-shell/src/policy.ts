import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type { FileSystemError, FileSystemRootOptions, NotAFileError } from "@better-fs-tools/fs";

import type { CloudflareShellFileInfo, CloudflareShellWorkspaceLike } from "./contract.ts";

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
    throw new TypeError('identity must be "none": a Workspace row has no stable identity');
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
  workspace: CloudflareShellWorkspaceLike,
  method: "stat" | "lstat",
  path: string,
): Promise<CloudflareShellFileInfo | null> {
  const value = await call(workspace[method](path), method);
  const stat = validateStat(value, method);
  if (stat !== null && resolvePosix("/", stat.path) !== path) {
    throw invalid(`${method} returned an entry for a different path`, method);
  }
  return stat;
}

export function validateStat(value: unknown, phase: string): CloudflareShellFileInfo | null {
  if (value === null) return null;
  if (value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${phase} returned neither an entry nor null`, phase);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.path !== "string" || !entry.path.startsWith("/") || entry.path.includes("\0")) {
    throw invalid(`${phase} returned an entry without an absolute path`, phase);
  }
  if (entry.type !== "file" && entry.type !== "directory" && entry.type !== "symlink") {
    throw invalid(`${phase} returned an unknown entry type`, phase);
  }
  if (!Number.isSafeInteger(entry.size) || (entry.size as number) < 0) {
    throw invalid(`${phase} returned an unusable size`, phase);
  }
  if (typeof entry.updatedAt !== "number" || !Number.isFinite(entry.updatedAt)) {
    throw invalid(`${phase} returned an unusable modification time`, phase);
  }
  if (entry.mimeType !== undefined && typeof entry.mimeType !== "string") {
    throw invalid(`${phase} returned an unusable mime type`, phase);
  }
  const mimeType =
    typeof entry.mimeType === "string" && entry.mimeType !== "" ? entry.mimeType : undefined;
  return {
    path: entry.path,
    type: entry.type,
    size: entry.size as number,
    updatedAt: entry.updatedAt,
    ...(mimeType === undefined ? {} : { mimeType }),
  };
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
    detail: "the Shell Workspace adapter failed",
    cause: { code: boundedCode(error) },
  };
}

export function validateWorkspace(workspace: CloudflareShellWorkspaceLike): void {
  if (workspace === null || typeof workspace !== "object" || Array.isArray(workspace)) {
    throw new TypeError("cloudflareShellFileSystem needs a Shell Workspace object");
  }
  const methods = ["stat", "lstat", "readFileBytes", "readDir"] as const;
  for (const method of methods) {
    if (typeof workspace[method] !== "function") {
      /* Security: without `lstat` a symlink could not be refused before `stat` follows it. */
      throw new TypeError(`the Shell Workspace must implement ${method}()`);
    }
  }
}
