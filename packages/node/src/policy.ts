import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import type { FileSystemError, NodeKind } from "@better-fs-tools/fs";

const DEFAULT_DENY_ROOTS = Object.freeze(["/dev", "/proc", "/sys"]);

export interface NodeFileSystemOptions {
  /** Default process.cwd(). */
  readonly cwd?: string;
  /** At least one. A path outside every root is refused. */
  readonly allowedRoots: readonly string[];
  /** Added to /dev, /proc, /sys. Refused before any inspection. */
  readonly denyRoots?: readonly string[];
  /** Default "follow-within-roots". */
  readonly symlinks?: "follow-within-roots" | "reject";
  readonly id?: string;
  /** A replace of a file with more than one hard link. Default "refuse" (W12). "in-place" truncates and writes, not atomic. */
  readonly hardLinks?: "refuse" | "in-place";
  /** Mode of a new file. The umask does not apply. Default 0o644. */
  readonly newFileMode?: number;
  /** Mode of a directory that createParents makes. The umask does not apply. Default 0o755. */
  readonly newDirectoryMode?: number;
}

export interface NodeConfig {
  readonly id: string;
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly denyRoots: readonly string[];
  readonly symlinks: "follow-within-roots" | "reject";
  readonly hardLinks: "refuse" | "in-place";
  readonly newFileMode: number;
  readonly newDirectoryMode: number;
}

export interface Roots {
  readonly allowed: readonly string[];
  readonly denied: readonly string[];
}

/** The resolved options and the lazily resolved real roots of one nodeFileSystem. */
export interface NodeContext {
  readonly config: NodeConfig;
  roots(): Promise<Roots>;
}

export interface TargetPaths {
  readonly resolvedPath: string;
  readonly displayPath: string;
}

export function nodeContext(options: NodeFileSystemOptions): NodeContext {
  const config = resolveOptions(options);
  let rootResolution: Promise<Roots> | undefined;
  const roots = async (): Promise<Roots> => {
    const pending =
      rootResolution ??
      (async () => ({
        allowed: await Promise.all(config.allowedRoots.map((root) => realpath(root))),
        denied: await Promise.all(
          config.denyRoots.map(async (root) => {
            try {
              return await realpath(root);
            } catch (error) {
              if (errorCode(error) === "ENOENT") return root;
              throw error;
            }
          }),
        ),
      }))();
    rootResolution = pending;
    try {
      return await pending;
    } catch (error) {
      rootResolution = undefined;
      throw error;
    }
  };
  return { config, roots };
}

/**
 * The checks that run before the filesystem is touched: the raw request and
 * its lexical form against the deny roots, and the lexical form against the
 * allowed roots. Returns the lexical absolute path.
 */
export function checkRequest(
  config: NodeConfig,
  requested: string,
): { readonly lexical: string } | { readonly error: FileSystemError } {
  // The refused namespaces are checked on the raw request too, so a request
  // for /dev/... is refused before the filesystem is touched.
  const rawDangerous = matchDenyRoot(requested, config.denyRoots);
  if (rawDangerous !== null) return { error: { reason: "dangerous-path", detail: rawDangerous } };
  const lexical = path.resolve(config.cwd, requested);
  if (!insideRoots(config.allowedRoots, lexical)) {
    return { error: { reason: "outside-allowed-roots" } };
  }
  const lexicalDangerous = matchDenyRoot(lexical, config.denyRoots);
  if (lexicalDangerous !== null) {
    return { error: { reason: "dangerous-path", detail: lexicalDangerous } };
  }
  return { lexical };
}

/** Checks a real path against the real roots. null when it is allowed. */
export function checkResolved(roots: Roots, target: string): FileSystemError | null {
  if (!insideRoots(roots.allowed, target)) return { reason: "outside-allowed-roots" };
  const dangerous = matchDenyRoot(target, roots.denied);
  return dangerous === null ? null : { reason: "dangerous-path", detail: dangerous };
}

export const SYMLINK_REJECTED = "the path contains a symbolic link and policy rejects symlinks";

function resolveOptions(options: NodeFileSystemOptions): NodeConfig {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("nodeFileSystem options must be an object");
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const roots = options.allowedRoots;
  if (
    !Array.isArray(roots) ||
    roots.length === 0 ||
    roots.some((root) => typeof root !== "string" || root === "")
  ) {
    throw new TypeError("allowedRoots must contain at least one non-empty path");
  }
  const symlinks = options.symlinks ?? "follow-within-roots";
  if (symlinks !== "follow-within-roots" && symlinks !== "reject") {
    throw new TypeError('symlinks must be "follow-within-roots" or "reject"');
  }
  const hardLinks = options.hardLinks ?? "refuse";
  if (hardLinks !== "refuse" && hardLinks !== "in-place") {
    throw new TypeError('hardLinks must be "refuse" or "in-place"');
  }
  const newFileMode = options.newFileMode ?? 0o644;
  const newDirectoryMode = options.newDirectoryMode ?? 0o755;
  if (!isMode(newFileMode)) throw new TypeError("newFileMode must be an integer from 0 to 0o7777");
  if (!isMode(newDirectoryMode)) {
    throw new TypeError("newDirectoryMode must be an integer from 0 to 0o7777");
  }
  const id = options.id ?? "node";
  if (typeof id !== "string" || id === "") throw new TypeError("id must be a non-empty string");
  return {
    id,
    cwd,
    allowedRoots: roots.map((root) => path.resolve(cwd, root)),
    denyRoots: [
      ...DEFAULT_DENY_ROOTS,
      ...(options.denyRoots ?? []).map((root) => path.resolve(cwd, root)),
    ],
    symlinks,
    hardLinks,
    newFileMode,
    newDirectoryMode,
  };
}

export function isMode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0o7777;
}

export function fail<TError>(error: TError): { readonly ok: false; readonly error: TError } {
  return { ok: false, error };
}

export function displayPathOf(cwd: string, resolvedPath: string): string {
  return path.relative(cwd, resolvedPath) || path.basename(resolvedPath);
}

export function targetPaths(cwd: string, resolvedPath: string): TargetPaths {
  return { resolvedPath, displayPath: displayPathOf(cwd, resolvedPath) };
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export function insideRoots(roots: readonly string[], candidate: string): boolean {
  return roots.some((root) => containsPath(root, candidate));
}

export function matchDenyRoot(candidate: string, denyRoots: readonly string[]): string | null {
  if (!candidate.startsWith("/")) return null;
  for (const root of denyRoots) {
    const normalized = root.replace(/\/$/u, "") || "/";
    if (candidate === normalized) return root;
    if (normalized === "/" ? candidate.startsWith("/") : candidate.startsWith(`${normalized}/`)) {
      return root;
    }
  }
  return null;
}

/** True when an existing component of the path is a symbolic link. Missing components end the walk. */
export async function hasSymlinkComponent(candidate: string): Promise<boolean> {
  const parsed = path.parse(candidate);
  const relative = path.relative(parsed.root, candidate);
  let current = parsed.root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return false;
      throw error;
    }
    if (stats.isSymbolicLink()) return true;
  }
  return false;
}

/** Device, inode, size and both nanosecond timestamps. */
export function nodeIdentity(stats: BigIntStats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
}

/** The object is not a regular file. Devices keep their character or block detail. */
export function notAFile(stats: BigIntStats, target: TargetPaths): FileSystemError {
  const kind: NodeKind = stats.isDirectory()
    ? "directory"
    : stats.isFIFO()
      ? "fifo"
      : stats.isSocket()
        ? "socket"
        : stats.isCharacterDevice() || stats.isBlockDevice()
          ? "device"
          : "other";
  const detail = stats.isCharacterDevice()
    ? "character device"
    : stats.isBlockDevice()
      ? "block device"
      : undefined;
  return detail === undefined
    ? { reason: "not-a-file", kind, target }
    : { reason: "not-a-file", kind, target, detail };
}

/**
 * Maps a Node error to a typed refusal. The errno code and the adapter step go
 * in `cause`; `detail` stays for the few cases with a useful plain reason.
 */
export function mapError(error: unknown, phase: string, target?: TargetPaths): FileSystemError {
  const code = errorCode(error);
  const cause = { code: code ?? "UNKNOWN", phase };
  switch (code) {
    case "ABORT_ERR":
      return { reason: "aborted", cause };
    case "ENOENT":
    case "ENOTDIR":
      return { reason: "not-found", cause };
    case "EACCES":
    case "EPERM":
      return { reason: "permission-denied", cause };
    case "ELOOP":
      return { reason: "denied", detail: "too many symbolic links", cause };
    case "EISDIR":
      return { reason: "not-a-file", kind: "directory", target: target ?? null, cause };
    case "ENAMETOOLONG":
      return { reason: "denied", detail: "the path is too long", cause };
    default:
      return { reason: "io", cause };
  }
}

export function errorCode(error: unknown): string | null {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  if (error instanceof Error && error.name === "AbortError") return "ABORT_ERR";
  return null;
}
