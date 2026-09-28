/**
 * Path policy, backend value checks and error mapping shared by reads and
 * writes. Nothing here touches the Workspace except through `inspect` and
 * `call`, so every backend failure is mapped in one place.
 */
import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type { FileSystemError, FileSystemRootOptions, NotAFileError } from "@better-fs-tools/fs";

import type { CloudflareShellFileInfo, CloudflareShellWorkspaceLike } from "./contract.ts";

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
 * Lexical containment, before the Workspace is touched at all. A relative path
 * is resolved against `cwd`, so a Worker prompt can use either form, and `..`
 * is folded by the resolver before the check rather than after it. Returns the
 * target and the innermost allowed root that holds it, where the symlink walk
 * starts.
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
  if (roots.denyRoots.some((root) => containsPosix(root, target))) {
    throw refuse({ reason: "denied", detail: "the path is inside a deny root" });
  }
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

/** One `stat` or `lstat` call, validated. */
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

/** Await one Workspace call, mapping whatever it throws exactly once. */
export async function call<T>(pending: Promise<T> | T, phase: string): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof AdapterRefusal) throw error;
    throw refuse(mapBackendError(error, phase));
  }
}

/**
 * Shell surfaces failures as thrown errors from its SQL and R2 layers. They are
 * mapped once, here, into the reason vocabulary, keeping a bounded code and the
 * phase for diagnostics and dropping the message.
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
    detail: "the Shell Workspace adapter failed",
    cause: { code: boundedCode(error) },
  };
}

/**
 * Only the read methods are checked here (decision W4). The write methods are
 * optional and checked when a write runs, so a read-only Workspace wrapper can
 * back a read tool.
 */
export function validateWorkspace(workspace: CloudflareShellWorkspaceLike): void {
  if (workspace === null || typeof workspace !== "object" || Array.isArray(workspace)) {
    throw new TypeError("cloudflareShellFileSystem needs a Shell Workspace object");
  }
  const methods = ["stat", "lstat", "readFileBytes", "readDir"] as const;
  for (const method of methods) {
    if (typeof workspace[method] !== "function") {
      /* Fail closed: an absent `lstat` would mean serving reads without a symlink check. */
      throw new TypeError(`the Shell Workspace must implement ${method}()`);
    }
  }
}
