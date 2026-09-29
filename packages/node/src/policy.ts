import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import type {
  FileSystemError,
  FileSystemRootOptions,
  NodeKind,
  SymlinkPolicy,
} from "@better-fs-tools/fs";

const DEFAULT_DENY_ROOTS = Object.freeze(["/dev", "/proc", "/sys"]);

/**
 * Options for nodeFileSystem. `cwd` defaults to process.cwd(), and a relative
 * `cwd` resolves against it. `denyRoots` are added to /dev, /proc, and /sys,
 * and a path under any of them is refused as dangerous-path. `symlinks`
 * defaults to "follow-within-roots". `identity` is always "required". `id`
 * defaults to "node".
 */
export interface NodeFileSystemOptions extends FileSystemRootOptions<SymlinkPolicy, "required"> {
  /** How to replace a file with more than one hard link. Default "refuse". "in-place" truncates and writes, which is not atomic. */
  readonly hardLinks?: "refuse" | "in-place";
  /**
   * Mode of a new file, exactly: the umask does not apply to a mode you set.
   * Default 0o666 less the process umask (0o644 under the usual umask 0o022).
   */
  readonly newFileMode?: number;
  /**
   * Mode of a directory that createParents makes, exactly. Default 0o777 less
   * the process umask (0o755 under 0o022).
   */
  readonly newDirectoryMode?: number;
}

export interface NodeConfig {
  readonly id: string;
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly denyRoots: readonly string[];
  readonly symlinks: SymlinkPolicy;
  readonly hardLinks: "refuse" | "in-place";
  /** null: the default, which depends on the umask when the file is made. */
  readonly newFileMode: number | null;
  /** null: the default, which depends on the umask when the directory is made. */
  readonly newDirectoryMode: number | null;
}

export interface Roots {
  readonly allowed: readonly string[];
  readonly denied: readonly string[];
}

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

export function checkRequest(
  config: NodeConfig,
  requested: string,
): { readonly lexical: string } | { readonly error: FileSystemError } {
  // The raw request is checked too, so /dev/... is refused before the filesystem is touched.
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
  if (options.identity !== undefined && options.identity !== "required") {
    throw new TypeError('identity must be "required": Node always reports device and inode');
  }
  const symlinks = options.symlinks ?? "follow-within-roots";
  if (symlinks !== "follow-within-roots" && symlinks !== "reject") {
    throw new TypeError('symlinks must be "follow-within-roots" or "reject"');
  }
  const hardLinks = options.hardLinks ?? "refuse";
  if (hardLinks !== "refuse" && hardLinks !== "in-place") {
    throw new TypeError('hardLinks must be "refuse" or "in-place"');
  }
  const newFileMode = options.newFileMode ?? null;
  const newDirectoryMode = options.newDirectoryMode ?? null;
  if (newFileMode !== null && !isMode(newFileMode)) {
    throw new TypeError("newFileMode must be an integer from 0 to 0o7777");
  }
  if (newDirectoryMode !== null && !isMode(newDirectoryMode)) {
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

export function createModes(config: NodeConfig): {
  readonly file: number;
  readonly directory: number;
} {
  if (config.newFileMode !== null && config.newDirectoryMode !== null) {
    return { file: config.newFileMode, directory: config.newDirectoryMode };
  }
  const umask = process.umask();
  return {
    file: config.newFileMode ?? 0o666 & ~umask,
    directory: config.newDirectoryMode ?? 0o777 & ~umask,
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

export function nodeIdentity(stats: BigIntStats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
}

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
