import { posixPaths } from "@better-fs-tools/fs";
import type {
  DirectoryEntry,
  ListOptions,
  ListOutcome,
  OpenFile,
  OpenOptions,
  OpenOutcome,
  VerifyOutcome,
} from "@better-fs-tools/fs";

import type {
  CloudflareComputerFileSystem,
  CloudflareComputerFileSystemLike,
  CloudflareComputerFileSystemOptions,
  CloudflareComputerStat,
} from "./contract.ts";
import {
  authorize,
  call,
  cancelWithoutWaiting,
  pathsFromSlashToTarget,
  displayPath,
  inspect,
  invalid,
  notAFile,
  refuse,
  resolveRoots,
  toFileSystemError,
  validateDirent,
  validateFileSystem,
  validateStream,
} from "./policy.ts";
import { COMPUTER_WRITE_CAPABILITIES, computerVersion, computerWrites } from "./write.ts";

export type {
  CloudflareComputerDirent,
  CloudflareComputerFileSystem,
  CloudflareComputerFileSystemLike,
  CloudflareComputerFileSystemOptions,
  CloudflareComputerStat,
} from "./contract.ts";

/**
 * Adapt a Cloudflare Computer workspace filesystem to the filesystem contract.
 *
 * @experimental Cloudflare Computer is preview software and this adapter is
 * pinned to the `0.2.1` declarations.
 */
export function cloudflareComputerFileSystem(
  workspaceFs: CloudflareComputerFileSystemLike,
  options: CloudflareComputerFileSystemOptions,
): CloudflareComputerFileSystem {
  validateFileSystem(workspaceFs);
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("cloudflareComputerFileSystem options must be an object");
  }
  const roots = resolveRoots(options);
  const { cwd } = roots;
  const id = options.id ?? "cloudflare-computer";
  if (typeof id !== "string" || id === "") throw new TypeError("id must be a non-empty string");

  const refuseSymlinksAlongPath = async (target: string): Promise<CloudflareComputerStat> => {
    for (const component of pathsFromSlashToTarget(target)) {
      const stat = await inspect(workspaceFs, "lstat", component, component !== target);
      if (stat.isSymbolicLink) {
        throw refuse({
          reason: "denied",
          detail:
            component === target
              ? "the path is a symbolic link and this adapter refuses symlinks"
              : "a path component is a symbolic link and this adapter refuses symlinks",
        });
      }
      if (component !== target && !stat.isDirectory) {
        throw refuse({ reason: "not-found", detail: "a path component is not a directory" });
      }
      if (component === target) return stat;
    }
    throw refuse(notAFile("directory", cwd, target));
  };

  return Object.freeze({
    id,
    capabilities: Object.freeze({ streaming: true, identity: false }),
    paths: posixPaths,
    cwd,
    allowedRoots: roots.allowedRoots,
    denyRoots: roots.denyRoots,
    symlinks: "reject",
    identity: "none",
    writeCapabilities: COMPUTER_WRITE_CAPABILITIES,
    ...computerWrites(workspaceFs, roots),

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      const signal = callOptions.signal;
      if (signal?.aborted) return { ok: false, error: { reason: "aborted" } };

      try {
        const { target } = authorize(roots, requested);
        await refuseSymlinksAlongPath(target);

        const stat = await inspect(workspaceFs, "stat", target, false);
        if (!stat.isFile) {
          throw refuse(notAFile(stat.isDirectory ? "directory" : "other", cwd, target));
        }

        if (signal?.aborted) throw refuse({ reason: "aborted" });
        /* Exactly one argument: other overloads buffer or return a string. */
        const stream = await call(workspaceFs.readFile(target), "readFile");
        validateStream(stream);
        if (signal?.aborted) {
          cancelWithoutWaiting(stream);
          throw refuse({ reason: "aborted" });
        }
        return { ok: true, file: computerOpenFile(workspaceFs, cwd, target, stat, stream) };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },

    async list(requested: string, listOptions: ListOptions): Promise<ListOutcome> {
      if (listOptions.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      const limit = listOptions.limit;
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        return {
          ok: false,
          error: { reason: "io", detail: "list limit must be a positive safe integer" },
        };
      }
      try {
        const { target } = authorize(roots, requested);
        const stat = target === "/" ? null : await refuseSymlinksAlongPath(target);
        if (stat !== null && !stat.isDirectory) {
          throw refuse({ reason: "not-found", detail: "not a directory" });
        }

        const oneMoreThanLimit = limit + 1;
        const listed = await call(
          workspaceFs.readdir(target, { limit: oneMoreThanLimit, offset: 0 }),
          "readdir",
        );
        if (!Array.isArray(listed)) throw invalid("readdir returned a non-array", "readdir");

        const entries: DirectoryEntry[] = [];
        for (const value of listed.slice(0, limit)) {
          entries.push(validateDirent(value, target));
        }
        return { ok: true, entries, truncated: listed.length > limit };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },
  });
}

function computerOpenFile(
  workspaceFs: CloudflareComputerFileSystemLike,
  cwd: string,
  target: string,
  stat: CloudflareComputerStat,
  stream: ReadableStream<Uint8Array>,
): OpenFile {
  let consumed = false;
  let closed = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  /* Not awaited: an RPC stub's cancel() may never settle once its peer is gone. */
  const release = (): void => {
    closed = true;
    const held = reader;
    reader = null;
    try {
      if (held === null) {
        void Promise.resolve(stream.cancel()).catch(() => {});
        return;
      }
      void Promise.resolve(held.cancel()).catch(() => {});
      /* A spec-compliant reader releases on cancel, an RPC stub may not. */
      try {
        held.releaseLock();
      } catch {
        /* Best effort. */
      }
    } catch {
      /* Best effort. */
    }
  };

  return {
    info: {
      resolvedPath: target,
      displayPath: displayPath(cwd, target),
      size: stat.size,
      mtimeMs: stat.mtime,
      identity: null,
      mimeType: null,
      version: computerVersion(stat),
    },
    bytes(): AsyncIterable<Uint8Array> {
      if (consumed) throw new TypeError("cloudflare computer byte source is single-use");
      consumed = true;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<Uint8Array>> {
              if (closed) return { done: true, value: undefined };
              const active = reader ?? (reader = acquireValidReader(stream));
              const item = await active.read();
              if (item === null || typeof item !== "object" || typeof item.done !== "boolean") {
                throw new TypeError("Cloudflare Computer's reader returned an invalid result");
              }
              if (item.done) {
                release();
                return { done: true, value: undefined };
              }
              if (!(item.value instanceof Uint8Array)) {
                throw new TypeError("Cloudflare Computer's stream yielded a non-Uint8Array chunk");
              }
              return { done: false, value: item.value };
            },
            async return(): Promise<IteratorResult<Uint8Array>> {
              release();
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    async verify(): Promise<VerifyOutcome> {
      try {
        const current = await inspect(workspaceFs, "lstat", target, false);
        const changed =
          current.isFile !== stat.isFile ||
          current.isDirectory !== stat.isDirectory ||
          current.isSymbolicLink !== stat.isSymbolicLink ||
          current.size !== stat.size ||
          current.mtime !== stat.mtime;
        return { ok: true, changed };
      } catch (error) {
        const mapped = toFileSystemError(error);
        if (mapped.reason === "not-found") return { ok: true, changed: true };
        return { ok: false, error: mapped };
      }
    },
    async close(): Promise<void> {
      consumed = true;
      if (closed) return;
      release();
    },
  };
}

function acquireValidReader(
  stream: ReadableStream<Uint8Array>,
): ReadableStreamDefaultReader<Uint8Array> {
  const reader: unknown = stream.getReader();
  if (
    reader === null ||
    typeof reader !== "object" ||
    typeof (reader as { read?: unknown }).read !== "function" ||
    typeof (reader as { cancel?: unknown }).cancel !== "function"
  ) {
    throw new TypeError("Cloudflare Computer's stream returned an unusable reader");
  }
  return reader as ReadableStreamDefaultReader<Uint8Array>;
}
