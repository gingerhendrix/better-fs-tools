/**
 * **Experimental.** Cloudflare Computer's workspace filesystem as a
 * `FileSystem`.
 *
 * `@cloudflare/computer` is preview software: its `WorkspaceFilesystem` surface
 * carries no stability guarantee, and this adapter is pinned to `0.2.1`. Treat
 * this package the same way: it can change with the upstream package.
 *
 * Nothing from `@cloudflare/computer` is imported here. The filesystem surface
 * the adapter needs is declared structurally below, so the package stays
 * importable in a Worker on a different Computer release, and so no Node
 * builtin can reach the Worker graph. Both the local `WorkspaceFilesystem` and
 * the RPC `WorkspaceFilesystemStub` satisfy it; the tests assert that against
 * the real declarations.
 *
 * Two Computer properties shape the whole adapter, and both are the mirror
 * image of the Shell adapter:
 *
 * - **Reads stream.** `readFile(path)` (the single-argument, no-encoding
 *   overload, the only one this adapter ever calls) resolves with a Web
 *   `ReadableStream<Uint8Array>`. `bytes()` exposes its chunks through one
 *   single-use async iterator and never buffers the object, so
 *   `capabilities.streaming` is true and no allocation ceiling is needed.
 *   `close()` cancels the stream, which is what makes an aborted or
 *   scan-capped read stop costing anything.
 * - **Identity is weak.** A `WorkspaceStatResult` does carry an `inode`, but
 *   it is a preview durable-object row rather than a durable identity claim, so
 *   `capabilities.identity` is false, `info.identity` is null, and `verify()`
 *   is mutation detection over type, size and modification time.
 *
 * Policy is adapter-owned and fails closed. Containment is checked lexically
 * before the backend is touched at all, and every path component from the
 * configured root to the target is `lstat`ed and refused if it is a symbolic
 * link. So a symlinked root, parent or leaf, a dangling link and a looping
 * link are all refused before `stat`, `readFile` or `readdir` can run.
 *
 * Writes (`stat`, `write`, `remove`) live in `write.ts` and keep the same
 * policy. A replace is one transaction and keeps the mode. There is no
 * compare-and-swap, and `writeCapabilities` says so.
 */
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
  cancel,
  components,
  display,
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

  /** Refuse a symlink anywhere from `/` down: above the root, the root, a parent, or the leaf. */
  const walk = async (target: string): Promise<CloudflareComputerStat> => {
    for (const component of components(target)) {
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
    /* Only reachable when the target is the root "/" itself, which is a directory. */
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
        await walk(target);

        /* `stat` follows links, but `walk` has already refused every one. */
        const stat = await inspect(workspaceFs, "stat", target, false);
        if (!stat.isFile) {
          throw refuse(notAFile(stat.isDirectory ? "directory" : "other", cwd, target));
        }

        if (signal?.aborted) throw refuse({ reason: "aborted" });
        /* Exactly one argument. Any other overload buffers or returns a string. */
        const stream = await call(workspaceFs.readFile(target), "readFile");
        validateStream(stream);
        if (signal?.aborted) {
          cancel(stream);
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
        /* A root of "/" has no component for walk() to inspect, and it is a directory. */
        const stat = target === "/" ? null : await walk(target);
        /* Same rule as memoryFileSystem: listing a non-directory is not-found. */
        if (stat !== null && !stat.isDirectory) {
          throw refuse({ reason: "not-found", detail: "not a directory" });
        }

        /* One more than asked for, so `truncated` is observed rather than guessed. */
        const listed = await call(
          workspaceFs.readdir(target, { limit: limit + 1, offset: 0 }),
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

/* -------------------------------------------------------------------------- */
/* The handle                                                                 */
/* -------------------------------------------------------------------------- */

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

  /**
   * Request cancellation and drop the reader.
   *
   * The cancel promise is deliberately **not** awaited. `close()` runs from the
   * core's `finally` and is awaited there, so a backend whose `cancel()` never
   * settles (a plausible failure for an RPC stub whose peer has gone away)
   * would otherwise hang the whole read after it had already produced its
   * result. Cancellation is still requested, and every rejection is
   * swallowed, including a reader that throws synchronously.
   */
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
      /* Best effort: a spec-compliant reader releases on cancel, a stub may not. */
      try {
        held.releaseLock();
      } catch {
        /* Ignored: the lock no longer matters once the handle is closed. */
      }
    } catch {
      /* Ignored: cancellation is best effort. */
    }
  };

  return {
    info: {
      resolvedPath: target,
      displayPath: display(cwd, target),
      size: stat.size,
      mtimeMs: stat.mtime,
      identity: null,
      mimeType: null,
      /* Weak: the same size and mtime that verify() compares. */
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
              const active = reader ?? (reader = acquire(stream));
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
        /* A file that has been removed has changed; it is not a failed check. */
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

/**
 * `getReader()` on a backend value that passed the stream shape check but may
 * still not behave like one. Failures here surface from `bytes()` rather than
 * from `open()`, so they are plain `TypeError`s: the core turns a throwing byte
 * source into `IO_ERROR` and still calls `close()`.
 */
function acquire(stream: ReadableStream<Uint8Array>): ReadableStreamDefaultReader<Uint8Array> {
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
