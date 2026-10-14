import type { Context } from "@earendil-works/chord/context";
import type {
  BinaryReader,
  ExecutionEnv,
  FileInfo as EnvFileInfo,
} from "@earendil-works/pi-durable/env";

import { posixPaths } from "@better-fs-tools/fs";
import type {
  DirectoryEntry,
  FileSystemRootOptions,
  FileSystemRootSettings,
  ListOptions,
  ListOutcome,
  MutateOptions,
  MutationOutcome,
  OpenFile,
  OpenOptions,
  OpenOutcome,
  VerifyOutcome,
  WritableFileSystem,
} from "@better-fs-tools/fs";

import {
  contextFor,
  fromFileError,
  locate,
  notAFile,
  realRoots,
  refuse,
  resolveRoots,
  toFileSystemError,
} from "./policy.ts";
import type { EnvSymlinkPolicy, Located, RealRoots } from "./policy.ts";
import { envVersion, envWrites } from "./write.ts";

/** Bytes that one positional read of an opened file asks for. */
const CHUNK_BYTES = 64 * 1024;

/**
 * The root options, with the environment's paths. `cwd` defaults to `env.cwd`,
 * and relative roots resolve against it. `symlinks` defaults to
 * "follow-within-roots": a link is followed, and its real path must stay inside
 * the real allowed roots. `identity` can only be "none". `id` defaults to
 * `pi-durable:<env.id>`.
 */
export interface ExecutionEnvFileSystemOptions extends FileSystemRootOptions<
  EnvSymlinkPolicy,
  "none"
> {
  /**
   * The Chord context of the tool call. Every environment call runs in it, so
   * cancelling the call stops the filesystem too. An operation's own signal
   * also stops it.
   */
  readonly context: Context;
}

/** A writable filesystem over a pi-durable ExecutionEnv. No compare-and-swap, no stage(). */
export interface ExecutionEnvFileSystem
  extends WritableFileSystem, FileSystemRootSettings<EnvSymlinkPolicy, "none"> {
  list(path: string, options: ListOptions): Promise<ListOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}

/**
 * Adapts the files of a pi-durable ExecutionEnv (a NodeExecutionEnv, pi-env's
 * RemoteExecutionEnv over SSH, or a container) to the Better FS Tools
 * filesystem contract. Paths are POSIX paths in the environment.
 *
 * Paths outside the allowed roots or inside a deny root are refused, both as
 * written and after symbolic links resolve. Reads stream through
 * openBinaryReader() without following a final symbolic link. Writes use the
 * environment's writeFile(), which replaces the content in place: a write keeps
 * the file's mode and hard links, but it is not atomic. Versions are weak: size
 * and modification time.
 */
export function executionEnvFileSystem(
  env: ExecutionEnv,
  options: ExecutionEnvFileSystemOptions,
): ExecutionEnvFileSystem {
  if (env === null || typeof env !== "object" || typeof env.canonicalPath !== "function") {
    throw new TypeError("executionEnvFileSystem needs a pi-durable ExecutionEnv");
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("executionEnvFileSystem options must be an object");
  }
  const { context } = options;
  if (context === null || typeof context !== "object" || typeof context.value !== "function") {
    throw new TypeError("executionEnvFileSystem needs the Chord context of the call");
  }
  const roots = resolveRoots(options, env.cwd);
  const id = options.id ?? `pi-durable:${env.id}`;
  if (typeof id !== "string" || id === "") throw new TypeError("id must be a non-empty string");

  // The real roots are found once, on the first call that needs them.
  let real: Promise<RealRoots> | null = null;
  const realOnce = (ctx: Context): Promise<RealRoots> => {
    if (real === null) {
      real = realRoots(env, roots, ctx);
      real.catch(() => {
        real = null;
      });
    }
    return real;
  };
  const resolve = async (requested: unknown, ctx: Context): Promise<Located> =>
    locate(env, roots, await realOnce(ctx), requested, ctx);

  return Object.freeze<ExecutionEnvFileSystem>({
    id,
    capabilities: Object.freeze({ identity: false }),
    paths: posixPaths,
    cwd: roots.cwd,
    allowedRoots: roots.allowedRoots,
    denyRoots: roots.denyRoots,
    symlinks: roots.symlinks,
    identity: "none",
    ...envWrites(env, (signal) => contextFor(context, signal), resolve),

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      if (callOptions.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      const ctx = contextFor(context, callOptions.signal);
      try {
        const located = await resolve(requested, ctx);
        if (!located.exists) throw refuse({ reason: "not-found" });
        const entry = await fileInfo(env, located.target, ctx);
        if (entry.kind !== "file") {
          throw refuse(notAFile(entry.kind === "directory" ? "directory" : "other", located));
        }
        // The target is a real path, so a symbolic link here was swapped in after locate().
        const opened = await env.openBinaryReader(located.target, { noFollow: true }, ctx);
        if (!opened.ok) {
          if (opened.error.code === "invalid") {
            throw refuse({ reason: "denied", detail: "the file changed into a symbolic link" });
          }
          throw refuse(fromFileError(opened.error, "openBinaryReader"));
        }
        const reader = opened.value;
        const info = await reader.info(ctx);
        if (!info.ok) {
          await reader.close(ctx);
          throw refuse(fromFileError(info.error, "info"));
        }
        return { ok: true, file: envOpenFile(env, ctx, located, info.value, reader) };
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
      const ctx = contextFor(context, listOptions.signal);
      try {
        const located = await resolve(requested, ctx);
        if (!located.exists) throw refuse({ reason: "not-found" });
        const opened = await env.openDirReader(located.target, ctx);
        if (!opened.ok) throw refuse(fromFileError(opened.error, "openDirReader"));
        const reader = opened.value;
        const entries: DirectoryEntry[] = [];
        let done = false;
        try {
          // One entry past the limit tells whether the listing was cut.
          while (!done && entries.length <= limit) {
            const page = await reader.next(limit + 1 - entries.length, ctx);
            if (!page.ok) throw refuse(fromFileError(page.error, "openDirReader"));
            done = page.value.done;
            for (const entry of page.value.entries) {
              entries.push({
                name: entry.name,
                type: entry.kind === "symlink" ? "other" : entry.kind,
              });
            }
          }
        } finally {
          await reader.close(ctx);
        }
        return { ok: true, entries: entries.slice(0, limit), truncated: entries.length > limit };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },
  });
}

export async function fileInfo(
  env: ExecutionEnv,
  target: string,
  ctx: Context,
): Promise<EnvFileInfo> {
  const result = await env.fileInfo(target, ctx);
  if (!result.ok) throw refuse(fromFileError(result.error, "fileInfo"));
  return result.value;
}

function envOpenFile(
  env: ExecutionEnv,
  ctx: Context,
  located: Located,
  info: EnvFileInfo,
  reader: BinaryReader,
): OpenFile {
  let consumed = false;
  let closed = false;
  return {
    info: {
      resolvedPath: located.target,
      displayPath: located.displayPath,
      size: info.size,
      mtimeMs: info.mtimeMs,
      identity: null,
      mimeType: null,
      version: envVersion(info),
    },
    bytes(): AsyncIterable<Uint8Array> {
      if (consumed) throw new TypeError("execution environment byte source is single-use");
      consumed = true;
      let offset = 0;
      let ended = closed;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<Uint8Array>> {
              if (ended || closed) return { done: true, value: undefined };
              const chunk = await reader.read(offset, CHUNK_BYTES, ctx);
              if (!chunk.ok) {
                ended = true;
                throw refuse(fromFileError(chunk.error, "read"));
              }
              offset += chunk.value.byteLength;
              if (chunk.value.byteLength < CHUNK_BYTES) ended = true;
              if (chunk.value.byteLength === 0) return { done: true, value: undefined };
              return { done: false, value: chunk.value };
            },
            async return(): Promise<IteratorResult<Uint8Array>> {
              ended = true;
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    async verify(): Promise<VerifyOutcome> {
      try {
        const current = await env.fileInfo(located.target, ctx);
        if (!current.ok) {
          if (current.error.code === "not_found") return { ok: true, changed: true };
          return { ok: false, error: fromFileError(current.error, "fileInfo") };
        }
        const now = current.value;
        const changed =
          now.kind !== info.kind || now.size !== info.size || now.mtimeMs !== info.mtimeMs;
        return { ok: true, changed };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      consumed = true;
      await reader.close(ctx);
    },
  };
}
