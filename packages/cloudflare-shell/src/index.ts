/**
 * A Cloudflare Shell Workspace as a `FileSystem`.
 *
 * Nothing from `@cloudflare/shell` is imported here. The Workspace surface this
 * adapter needs is declared structurally below, so the package stays
 * importable in a Worker that pins a different Shell release, and nothing
 * Node-specific can reach the Worker graph.
 *
 * Two Shell properties shape the whole adapter:
 *
 * - **Reads are buffered and uncancellable.** `readFileBytes` resolves with the
 *   whole object and offers no signal, so the adapter owns an allocation
 *   ceiling on both sides of the call (the size Shell reports before it, the
 *   length it returns after it) and checks abort around it. The read happens in
 *   `open()`, which keeps `bytes()` synchronous: there is no suspended await
 *   for `close()` to wait on after an abort.
 * - **Identity is weak.** A Workspace row has no inode or ETag, so
 *   `capabilities.identity` is false, `info.identity` is null, and `verify()`
 *   is mutation detection over bounded metadata rather than an identity claim.
 *
 * Policy is adapter-owned and fails closed. Containment is checked lexically
 * before any Workspace call, and every path component from the configured root
 * to the target is `lstat`ed and refused if it is a symlink. A Workspace that
 * does not implement `lstat` is rejected at construction rather than served
 * with a weaker rule.
 *
 * Writes (`stat`, `write`, `remove`) live in `write.ts` and keep the same
 * policy. Shell has no compare-and-swap, no atomic replace and no modes, and
 * `writeCapabilities` says so.
 */
import { posixPaths, resolvePosix } from "@better-fs-tools/fs";
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
  ShellFileInfo,
  ShellWorkspaceFileSystem,
  ShellWorkspaceFileSystemOptions,
  ShellWorkspaceLike,
} from "./contract.ts";
import {
  authorize,
  call,
  components,
  display,
  inspect,
  invalid,
  notAFile,
  refuse,
  toFileSystemError,
  validateStat,
  validateWorkspace,
} from "./policy.ts";
import { SHELL_WRITE_CAPABILITIES, shellVersion, shellWrites } from "./write.ts";

export type {
  ShellFileInfo,
  ShellWorkspaceFileSystem,
  ShellWorkspaceFileSystemOptions,
  ShellWorkspaceLike,
} from "./contract.ts";

/** 4 MiB. Far above any view the read tool will produce, far below a Worker's memory. */
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/**
 * Adapt a Cloudflare Shell Workspace to the filesystem contract.
 *
 * Every method resolves the requested path against `root`, refuses anything
 * outside it before the Workspace is touched, and walks the path with `lstat`
 * so a symlinked root, parent or leaf is refused before any byte is read.
 */
export function shellWorkspaceFileSystem(
  workspace: ShellWorkspaceLike,
  options: ShellWorkspaceFileSystemOptions,
): ShellWorkspaceFileSystem {
  validateWorkspace(workspace);
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("shellWorkspaceFileSystem options must be an object");
  }
  if (
    typeof options.root !== "string" ||
    !options.root.startsWith("/") ||
    options.root.includes("\0")
  ) {
    throw new TypeError("root must be an absolute POSIX path without NUL");
  }
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes <= 0) {
    throw new TypeError("maxBufferedBytes must be a positive safe integer");
  }
  const root = resolvePosix("/", options.root);

  /** Refuse a symlinked root, a symlinked parent and a symlinked leaf. */
  const walk = async (target: string): Promise<ShellFileInfo> => {
    for (const component of components(root, target)) {
      const stat = await inspect(workspace, "lstat", component);
      if (stat === null) {
        throw refuse({
          reason: "not-found",
          ...(component === target ? {} : { detail: "a path component does not exist" }),
        });
      }
      if (stat.type === "symlink") {
        throw refuse({
          reason: "denied",
          detail:
            component === target
              ? "the path is a symbolic link and this adapter refuses symlinks"
              : "a path component is a symbolic link and this adapter refuses symlinks",
        });
      }
      if (component !== target && stat.type !== "directory") {
        throw refuse({ reason: "not-found", detail: "a path component is not a directory" });
      }
      if (component === target) return stat;
    }
    /* Only reachable when the target is the root "/" itself, which is a directory. */
    throw refuse(notAFile("directory", root, target));
  };

  return Object.freeze({
    id: options.id ?? "cloudflare-shell",
    capabilities: Object.freeze({ streaming: false, identity: false }),
    paths: posixPaths,
    root,
    maxBufferedBytes,
    writeCapabilities: SHELL_WRITE_CAPABILITIES,
    ...shellWrites(workspace, root, maxBufferedBytes),

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      const signal = callOptions.signal;
      if (signal?.aborted) return { ok: false, error: { reason: "aborted" } };

      try {
        const target = authorize(root, requested);
        await walk(target);

        const stat = await inspect(workspace, "stat", target);
        if (stat === null) throw refuse({ reason: "not-found" });
        if (stat.type !== "file") {
          throw refuse(notAFile(stat.type === "directory" ? "directory" : "other", root, target));
        }
        if (stat.size > maxBufferedBytes) {
          throw refuse({
            reason: "denied",
            detail: `the object exceeds the ${maxBufferedBytes}-byte buffered ceiling`,
          });
        }

        /*
         * The uncancellable window. Shell buffers the whole object and takes no
         * signal, so abort is checked on both sides: before, to avoid starting
         * work nobody wants, and after, because the caller may have given up
         * while Shell was reading. Backend work can still finish after the
         * caller has been told the read was aborted.
         */
        if (signal?.aborted) throw refuse({ reason: "aborted" });
        const bytes = await call(workspace.readFileBytes(target), "readFileBytes");
        if (signal?.aborted) throw refuse({ reason: "aborted" });
        if (bytes === null) {
          throw refuse({
            reason: "not-found",
            detail: "the entry disappeared before its buffered read",
          });
        }
        if (!(bytes instanceof Uint8Array)) {
          throw invalid("readFileBytes returned neither bytes nor null", "readFileBytes");
        }
        if (bytes.byteLength > maxBufferedBytes) {
          throw refuse({
            reason: "denied",
            detail: `the backend returned more than the ${maxBufferedBytes}-byte buffered ceiling`,
          });
        }
        return { ok: true, file: shellOpenFile(workspace, root, target, stat, bytes) };
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
        const target = authorize(root, requested);
        /* A root of "/" has no component for walk() to inspect, and it is a directory. */
        const stat = target === "/" ? null : await walk(target);
        /* Same rule as memoryFileSystem: listing a non-directory is not-found. */
        if (stat !== null && stat.type !== "directory") {
          throw refuse({ reason: "not-found", detail: "not a directory" });
        }

        /* One past the limit, so `truncated` reports the directory and not the request. */
        const listed = await call(
          workspace.readDir(target, { limit: limit + 1, offset: 0 }),
          "readDir",
        );
        if (!Array.isArray(listed)) throw invalid("readDir returned a non-array", "readDir");

        const entries: DirectoryEntry[] = [];
        for (const value of listed.slice(0, limit)) {
          const entry = validateStat(value, "readDir");
          if (entry === null) throw invalid("readDir returned a null entry", "readDir");
          const path = resolvePosix("/", entry.path);
          if (posixPaths.dirname(path) !== target) {
            throw invalid("readDir returned an entry outside the listed directory", "readDir");
          }
          entries.push({
            name: posixPaths.basename(path),
            type: entry.type === "symlink" ? "other" : entry.type,
          });
        }
        return { ok: true, entries, truncated: listed.length > limit };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },
  });
}

function shellOpenFile(
  workspace: ShellWorkspaceLike,
  root: string,
  target: string,
  stat: ShellFileInfo,
  bytes: Uint8Array,
): OpenFile {
  let consumed = false;
  let closed = false;
  return {
    info: {
      resolvedPath: target,
      displayPath: display(root, target),
      size: stat.size,
      mtimeMs: stat.updatedAt,
      /* Weak by capability: a Workspace row carries nothing durable to compare. */
      identity: null,
      mimeType: stat.mimeType ?? null,
      /* Weak: the same size and updatedAt that verify() compares. */
      version: shellVersion(stat),
    },
    bytes(): AsyncIterable<Uint8Array> {
      if (consumed) throw new TypeError("shell workspace byte source is single-use");
      consumed = true;
      /*
       * The object is already in memory, so this iterator never awaits anything
       * a `close()` after an abort would have to wait for.
       */
      let sent = closed || bytes.byteLength === 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<Uint8Array>> {
              if (sent || closed) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: bytes };
            },
            async return(): Promise<IteratorResult<Uint8Array>> {
              sent = true;
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    async verify(): Promise<VerifyOutcome> {
      try {
        /* `lstat`, so a file replaced by a symlink reads as a change, not as a file. */
        const current = await inspect(workspace, "lstat", target);
        if (current === null) return { ok: true, changed: true };
        const changed =
          current.type !== stat.type ||
          current.size !== stat.size ||
          current.updatedAt !== stat.updatedAt;
        return { ok: true, changed };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },
    async close(): Promise<void> {
      closed = true;
      consumed = true;
    },
  };
}
