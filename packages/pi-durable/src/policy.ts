import { withAbortSignal } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord/context";
import type { FileError, FileSystem as EnvFileSystem } from "@earendil-works/pi-durable/env";

import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type { FileSystemError, FileSystemRootOptions, NotAFileError } from "@better-fs-tools/fs";

export type EnvSymlinkPolicy = "follow-within-roots" | "reject";

export interface Roots {
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly denyRoots: readonly string[];
  readonly symlinks: EnvSymlinkPolicy;
}

/** A path after the roots, the deny roots, and the symlink policy accepted it. */
export interface Located {
  /** The real path: symbolic links resolved. For a missing file, its real parent and the name. */
  readonly target: string;
  readonly displayPath: string;
  readonly exists: boolean;
  /** Real paths of missing parent directories, outermost first. Empty when the target exists. */
  readonly missingDirectories: readonly string[];
}

/** The context of one operation: the call's context, also stopped by the operation's signal. */
export function contextFor(base: Context, signal: AbortSignal | undefined): Context {
  return signal === undefined ? base : withAbortSignal(signal, base);
}

export function resolveRoots(
  options: FileSystemRootOptions<EnvSymlinkPolicy, "none">,
  envCwd: string,
): Roots {
  const base = absolutePath(options.cwd ?? envCwd, "cwd");
  const allowed = options.allowedRoots;
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new TypeError("allowedRoots must be a non-empty array");
  }
  if (options.denyRoots !== undefined && !Array.isArray(options.denyRoots)) {
    throw new TypeError("denyRoots must be an array");
  }
  const symlinks = options.symlinks ?? "follow-within-roots";
  if (symlinks !== "follow-within-roots" && symlinks !== "reject") {
    throw new TypeError('symlinks must be "follow-within-roots" or "reject"');
  }
  if (options.identity !== undefined && options.identity !== "none") {
    throw new TypeError('identity must be "none": an execution environment has no file identity');
  }
  return {
    cwd: base,
    allowedRoots: Object.freeze(allowed.map((root) => configuredRoot(base, root))),
    denyRoots: Object.freeze((options.denyRoots ?? []).map((root) => configuredRoot(base, root))),
    symlinks,
  };
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

/** The real paths of the configured roots, found once for each filesystem. */
export interface RealRoots {
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly denyRoots: readonly string[];
}

export async function realRoots(
  env: EnvFileSystem,
  roots: Roots,
  ctx: Context,
): Promise<RealRoots> {
  const real = async (path: string): Promise<string> => {
    const result = await env.canonicalPath(path, ctx);
    if (result.ok) return resolvePosix("/", result.value);
    // A root that does not exist yet keeps its configured path.
    if (result.error.code === "not_found" || result.error.code === "not_supported") return path;
    throw refuse(fromFileError(result.error, "canonicalPath"));
  };
  return {
    cwd: await real(roots.cwd),
    allowedRoots: await Promise.all(roots.allowedRoots.map(real)),
    denyRoots: await Promise.all(roots.denyRoots.map(real)),
  };
}

/**
 * Checks the requested path against the configured roots, then resolves its
 * symbolic links and checks the real path against the real roots.
 */
export async function locate(
  env: EnvFileSystem,
  roots: Roots,
  real: RealRoots,
  requested: unknown,
  ctx: Context,
): Promise<Located> {
  if (typeof requested !== "string" || requested === "") {
    throw refuse({ reason: "io", detail: "the requested path must be a non-empty string" });
  }
  if (requested.includes("\0")) {
    throw refuse({ reason: "dangerous-path", detail: "the path contains NUL" });
  }
  const lexical = resolvePosix(roots.cwd, requested);
  checkRoots(roots.denyRoots, roots.allowedRoots, lexical);

  const resolved = await resolveReal(env, lexical, ctx);
  const root = innermost(roots.allowedRoots, lexical)!;
  const realRoot = real.allowedRoots[roots.allowedRoots.indexOf(root)]!;
  if (roots.symlinks === "reject") {
    const expected = posixJoin(realRoot, lexical.slice(root === "/" ? 1 : root.length + 1));
    if (resolved.target !== expected) {
      throw refuse({
        reason: "denied",
        detail: "the path contains a symbolic link and policy rejects symlinks",
      });
    }
  }
  checkRoots(real.denyRoots, real.allowedRoots, resolved.target);
  return {
    target: resolved.target,
    displayPath: displayPath(real.cwd, resolved.target),
    exists: resolved.exists,
    missingDirectories: resolved.missingDirectories,
  };
}

function checkRoots(denyRoots: readonly string[], allowedRoots: readonly string[], path: string) {
  const denied = denyRoots.find((root) => containsPosix(root, path));
  if (denied !== undefined) throw refuse({ reason: "dangerous-path", detail: denied });
  if (innermost(allowedRoots, path) === null) throw refuse({ reason: "outside-allowed-roots" });
}

function innermost(roots: readonly string[], path: string): string | null {
  let found: string | null = null;
  for (const root of roots) {
    if (containsPosix(root, path) && (found === null || root.length > found.length)) found = root;
  }
  return found;
}

function posixJoin(dir: string, rest: string): string {
  return rest === "" ? dir : posixPaths.join(dir, rest);
}

async function resolveReal(
  env: EnvFileSystem,
  lexical: string,
  ctx: Context,
): Promise<{ target: string; exists: boolean; missingDirectories: string[] }> {
  const whole = await env.canonicalPath(lexical, ctx);
  if (whole.ok)
    return { target: resolvePosix("/", whole.value), exists: true, missingDirectories: [] };
  if (whole.error.code !== "not_found") throw refuse(fromFileError(whole.error, "canonicalPath"));

  // Walk up to the nearest existing ancestor and join the missing names to its real path.
  const missing: string[] = [];
  let current = lexical;
  for (;;) {
    const parent = posixPaths.dirname(current);
    missing.unshift(posixPaths.basename(current));
    if (parent === current) throw refuse({ reason: "not-found", detail: "no ancestor exists" });
    const found = await env.canonicalPath(parent, ctx);
    if (!found.ok) {
      if (found.error.code !== "not_found")
        throw refuse(fromFileError(found.error, "canonicalPath"));
      current = parent;
      continue;
    }
    const realParent = resolvePosix("/", found.value);
    // A dangling symbolic link has no real path, and a write would follow it.
    const first = posixJoin(realParent, missing[0]!);
    const entry = await env.fileInfo(first, ctx);
    if (entry.ok) {
      throw refuse({ reason: "denied", detail: "a path component is a dangling symbolic link" });
    }
    if (entry.error.code !== "not_found") throw refuse(fromFileError(entry.error, "fileInfo"));
    const paths: string[] = [];
    let path = realParent;
    for (const name of missing) {
      path = posixJoin(path, name);
      paths.push(path);
    }
    return { target: paths.at(-1)!, exists: false, missingDirectories: paths.slice(0, -1) };
  }
}

export function displayPath(cwd: string, target: string): string {
  if (!containsPosix(cwd, target)) return target;
  if (target === cwd) return posixPaths.basename(target) || "/";
  return target.slice(cwd === "/" ? 1 : cwd.length + 1);
}

export function notAFile(kind: NotAFileError["kind"], located: Located): NotAFileError {
  return {
    reason: "not-a-file",
    kind,
    target: { resolvedPath: located.target, displayPath: located.displayPath },
  };
}

/** Maps an execution environment FileError to a filesystem error. */
export function fromFileError(error: FileError, phase: string): FileSystemError {
  const cause = { code: error.code, phase };
  switch (error.code) {
    case "aborted":
      return { reason: "aborted", cause };
    case "not_found":
    case "not_directory":
      return { reason: "not-found", cause };
    case "permission_denied":
      return { reason: "permission-denied", cause };
    case "is_directory":
      return { reason: "not-a-file", kind: "directory", target: null, cause };
    case "not_supported":
      return { reason: "unsupported", cause };
    case "invalid":
    case "unknown":
      return { reason: "io", detail: phase, cause };
  }
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

export function toFileSystemError(error: unknown): FileSystemError {
  if (error instanceof AdapterRefusal) return error.error;
  return {
    reason: "io",
    detail: "the execution environment adapter failed",
    cause: { code: error instanceof Error ? error.name.slice(0, 40) : "UNKNOWN" },
  };
}
