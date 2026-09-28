import { constants } from "node:fs";
import type { BigIntStats, Dir } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import { posixPaths } from "@better-fs-tools/fs";
import type {
  DirectoryEntry,
  FileSystemRootSettings,
  ListOptions,
  ListOutcome,
  OpenFile,
  OpenOptions,
  OpenOutcome,
  MutateOptions,
  MutationOutcome,
  StageOutcome,
  SymlinkPolicy,
  VerifyOutcome,
  WritableFileSystem,
  WriteOptions,
} from "@better-fs-tools/fs";

import {
  checkRequest,
  checkResolved,
  errorCode,
  fail,
  hasSymlinkComponent,
  insideRoots,
  mapError,
  matchDenyRoot,
  nodeContext,
  nodeIdentity,
  notAFile,
  SYMLINK_REJECTED,
  targetPaths as pathsOf,
} from "./policy.ts";
import type { NodeFileSystemOptions, Roots, TargetPaths } from "./policy.ts";
import { nodeStat } from "./stat.ts";
import { nodeWrites } from "./write.ts";

const DESCRIPTOR_READ_BYTES = 64 * 1024;

/** A WritableFileSystem with every optional method present, and its resolved root options. */
export interface NodeFileSystem
  extends WritableFileSystem, FileSystemRootSettings<SymlinkPolicy, "required"> {
  list(path: string, options: ListOptions): Promise<ListOutcome>;
  stage(path: string, bytes: Uint8Array, options: WriteOptions): Promise<StageOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
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
 *
 * `stat()`, `write()`, `stage()`, and `remove()` apply the same roots, deny
 * roots, and symlink policy. A replace goes through a temp file and rename(),
 * a create through link(). See stat.ts and write.ts.
 */
export function nodeFileSystem(options: NodeFileSystemOptions): NodeFileSystem {
  if (process.platform === "win32") {
    throw new TypeError("nodeFileSystem supports POSIX platforms only in this release");
  }
  const context = nodeContext(options);
  const { config } = context;
  const writes = nodeWrites(context);

  return Object.freeze({
    id: config.id,
    cwd: config.cwd,
    allowedRoots: Object.freeze([...config.allowedRoots]),
    denyRoots: Object.freeze([...config.denyRoots]),
    symlinks: config.symlinks,
    identity: "required",
    capabilities: Object.freeze({ streaming: true, identity: true }),
    writeCapabilities: Object.freeze({ atomic: true, compareAndSwap: true, preserveMode: true }),
    paths: posixPaths,
    stat: (path: string, callOptions: OpenOptions = {}) => nodeStat(context, path, callOptions),
    write: writes.write,
    stage: writes.stage,
    remove: writes.remove,

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      const signal = callOptions.signal;
      if (signal?.aborted) return fail({ reason: "aborted" });

      const checked = checkRequest(config, requested);
      if ("error" in checked) return fail(checked.error);
      const { lexical } = checked;

      let roots: Roots;
      try {
        roots = await context.roots();
      } catch (error) {
        return fail(mapError(error, "root-resolution"));
      }

      let target: string;
      try {
        if (config.symlinks === "reject" && (await hasSymlinkComponent(lexical))) {
          return fail({ reason: "denied", detail: SYMLINK_REJECTED });
        }
        target = await realpath(lexical);
      } catch (error) {
        return fail(mapError(error, "resolve"));
      }

      const refused = checkResolved(roots, target);
      if (refused !== null) return fail(refused);

      const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
      const nonBlock = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
      const targetPaths = pathsOf(config.cwd, target);
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
        roots = await context.roots();
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
