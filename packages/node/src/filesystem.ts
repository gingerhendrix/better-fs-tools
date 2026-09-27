import { constants } from "node:fs";
import type { BigIntStats, Dir } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import { posixPaths } from "@better-fs-tools/fs";
import type {
  DirectoryEntry,
  FileSystem,
  FileSystemError,
  ListOptions,
  ListOutcome,
  NodeKind,
  OpenFile,
  OpenOptions,
  OpenOutcome,
  VerifyOutcome,
} from "@better-fs-tools/fs";

const DESCRIPTOR_READ_BYTES = 64 * 1024;
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
}

interface Roots {
  readonly allowed: readonly string[];
  readonly denied: readonly string[];
}

/**
 * Descriptor-backed POSIX filesystem.
 *
 * All policy lives here: containment, symlink handling and refused namespaces.
 * `open()` resolves, authorizes, checks the target type and opens one
 * descriptor with `O_NOFOLLOW | O_NONBLOCK`, then works from that descriptor
 * only. Statting the descriptor rather than the path is what closes the
 * time-of-check to time-of-use gap, and opening non-blocking is what stops a
 * FIFO from wedging the caller before the type check runs.
 */
export function nodeFileSystem(options: NodeFileSystemOptions): FileSystem {
  if (process.platform === "win32") {
    throw new TypeError("nodeFileSystem supports POSIX platforms only in this release");
  }
  const config = resolveOptions(options);
  let rootResolution: Promise<Roots> | undefined;

  const resolveRoots = async (): Promise<Roots> => {
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

  return Object.freeze({
    id: config.id,
    capabilities: Object.freeze({ streaming: true, identity: true }),
    paths: posixPaths,

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      const signal = callOptions.signal;
      if (signal?.aborted) return fail({ reason: "aborted" });

      // The refused namespaces are checked on the raw request too, so a
      // request for /dev/... is refused before the filesystem is touched.
      const rawDangerous = matchDenyRoot(requested, config.denyRoots);
      if (rawDangerous !== null) return fail({ reason: "dangerous-path", detail: rawDangerous });

      const lexical = path.resolve(config.cwd, requested);
      if (!insideRoots(config.allowedRoots, lexical)) {
        return fail({ reason: "outside-allowed-roots" });
      }
      const lexicalDangerous = matchDenyRoot(lexical, config.denyRoots);
      if (lexicalDangerous !== null) {
        return fail({ reason: "dangerous-path", detail: lexicalDangerous });
      }

      let roots: Roots;
      try {
        roots = await resolveRoots();
      } catch (error) {
        return fail(mapError(error, "root-resolution"));
      }

      let target: string;
      try {
        if (config.symlinks === "reject" && (await hasSymlinkComponent(lexical))) {
          return fail({
            reason: "denied",
            detail: "the path contains a symbolic link and policy rejects symlinks",
          });
        }
        target = await realpath(lexical);
      } catch (error) {
        return fail(mapError(error, "resolve"));
      }

      if (!insideRoots(roots.allowed, target)) return fail({ reason: "outside-allowed-roots" });
      const resolvedDangerous = matchDenyRoot(target, roots.denied);
      if (resolvedDangerous !== null) {
        return fail({ reason: "dangerous-path", detail: resolvedDangerous });
      }

      const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
      const nonBlock = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
      const targetPaths = { resolvedPath: target, displayPath: displayPathOf(config.cwd, target) };
      let handle: FileHandle;
      try {
        handle = await open(target, constants.O_RDONLY | noFollow | nonBlock);
      } catch (error) {
        // Linux refuses open() on a socket with ENXIO, before the descriptor
        // type check can run. Name the kind from the path instead.
        if (errorCode(error) === "ENXIO") {
          const stats = await lstat(target, { bigint: true }).catch(() => null);
          if (stats !== null && !stats.isFile()) return fail(notAFile(stats, targetPaths));
        }
        return fail(mapError(error, "open", targetPaths));
      }

      try {
        const stats = await handle.stat({ bigint: true });
        if (!stats.isFile()) {
          await handle.close();
          return fail(notAFile(stats, targetPaths));
        }
        if (stats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
          await handle.close();
          return fail({
            reason: "denied",
            detail: "the reported file size is outside the safe numeric range",
          });
        }
        return { ok: true, file: nodeOpenFile(handle, targetPaths, stats, signal) };
      } catch (error) {
        await handle.close().catch(() => {});
        return fail(mapError(error, "inspect", targetPaths));
      }
    },

    async list(directory: string, listOptions: ListOptions): Promise<ListOutcome> {
      if (listOptions.signal?.aborted) return fail({ reason: "aborted" });
      const lexical = path.resolve(config.cwd, directory);
      if (!insideRoots(config.allowedRoots, lexical)) {
        return fail({ reason: "outside-allowed-roots" });
      }
      const dangerous = matchDenyRoot(lexical, config.denyRoots);
      if (dangerous !== null) return fail({ reason: "dangerous-path", detail: dangerous });

      let roots: Roots;
      let target: string;
      try {
        roots = await resolveRoots();
        if (config.symlinks === "reject" && (await hasSymlinkComponent(lexical))) {
          return fail({ reason: "denied", detail: "symlinked directory" });
        }
        target = await realpath(lexical);
      } catch (error) {
        return fail(mapError(error, "list-resolve"));
      }
      if (!insideRoots(roots.allowed, target)) return fail({ reason: "outside-allowed-roots" });
      if (matchDenyRoot(target, roots.denied) !== null) return fail({ reason: "dangerous-path" });

      const entries: DirectoryEntry[] = [];
      let truncated = false;
      try {
        const opened = await opendir(target);
        try {
          for await (const entry of opened) {
            if (entries.length >= listOptions.limit) {
              truncated = true;
              break;
            }
            entries.push({
              name: entry.name,
              type: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
            });
          }
        } finally {
          await closeDirectory(opened);
        }
      } catch (error) {
        return fail(mapError(error, "list"));
      }
      return { ok: true, entries, truncated };
    },
  });
}

/* -------------------------------------------------------------------------- */

interface TargetPaths {
  readonly resolvedPath: string;
  readonly displayPath: string;
}

function nodeOpenFile(
  handle: FileHandle,
  target: TargetPaths,
  stats: BigIntStats,
  signal: AbortSignal | undefined,
): OpenFile {
  const identity = nodeIdentity(stats);
  let consumed = false;
  let closed = false;
  return {
    info: {
      resolvedPath: target.resolvedPath,
      displayPath: target.displayPath,
      size: Number(stats.size),
      mtimeMs: Number(stats.mtimeNs) / 1_000_000,
      identity,
      mimeType: null,
      version: identity,
    },
    bytes(): AsyncIterable<Uint8Array> {
      if (consumed) throw new TypeError("descriptor byte source is single-use");
      consumed = true;
      let stopped = false;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<Uint8Array>> {
              if (stopped || closed) return { done: true, value: undefined };
              if (signal?.aborted) return { done: true, value: undefined };
              // A fresh buffer for each chunk: a consumer may keep a chunk
              // after it asks for the next one.
              const buffer = new Uint8Array(DESCRIPTOR_READ_BYTES);
              const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
              if (stopped || closed || bytesRead === 0) {
                stopped = true;
                return { done: true, value: undefined };
              }
              return { done: false, value: buffer.subarray(0, bytesRead) };
            },
            async return(): Promise<IteratorResult<Uint8Array>> {
              stopped = true;
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    async verify(): Promise<VerifyOutcome> {
      if (closed) return fail({ reason: "io", detail: "the handle is closed" });
      try {
        const current = await handle.stat({ bigint: true });
        return { ok: true, changed: nodeIdentity(current) !== identity };
      } catch (error) {
        return fail(mapError(error, "verify"));
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await handle.close().catch(() => {});
    },
  };
}

/** `for await` closes the directory itself when it runs to the end. */
async function closeDirectory(directory: Dir): Promise<void> {
  try {
    // Bun's Dir.close() resolves to undefined, so this cannot chain.
    await directory.close();
  } catch (error) {
    if (errorCode(error) !== "ERR_DIR_CLOSED") throw error;
  }
}

/** Device, inode, size and both nanosecond timestamps. */
function nodeIdentity(stats: BigIntStats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
}

function resolveOptions(options: NodeFileSystemOptions) {
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
  };
}

function fail(error: FileSystemError): { readonly ok: false; readonly error: FileSystemError } {
  return { ok: false, error };
}

function displayPathOf(cwd: string, resolvedPath: string): string {
  return path.relative(cwd, resolvedPath) || path.basename(resolvedPath);
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function insideRoots(roots: readonly string[], candidate: string): boolean {
  return roots.some((root) => containsPath(root, candidate));
}

function matchDenyRoot(candidate: string, denyRoots: readonly string[]): string | null {
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

async function hasSymlinkComponent(candidate: string): Promise<boolean> {
  const parsed = path.parse(candidate);
  const relative = path.relative(parsed.root, candidate);
  let current = parsed.root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) return true;
  }
  return false;
}

/** The descriptor is not a regular file. Devices keep their character or block detail. */
function notAFile(stats: BigIntStats, target: TargetPaths): FileSystemError {
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
function mapError(error: unknown, phase: string, target?: TargetPaths): FileSystemError {
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

function errorCode(error: unknown): string | null {
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
