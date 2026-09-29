import { DEFAULT_MAX_BUFFERED_BYTES, posixPaths, resolvePosix } from "@better-fs-tools/fs";
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
  CloudflareShellFileInfo,
  CloudflareShellFileSystem,
  CloudflareShellFileSystemOptions,
  CloudflareShellWorkspaceLike,
} from "./contract.ts";
import {
  authorize,
  call,
  displayPath,
  inspect,
  invalid,
  notAFile,
  pathsFromSlashToTarget,
  refuse,
  resolveRoots,
  toFileSystemError,
  validateStat,
  validateWorkspace,
} from "./policy.ts";
import { SHELL_WRITE_CAPABILITIES, shellVersion, shellWrites } from "./write.ts";

export type {
  CloudflareShellFileInfo,
  CloudflareShellFileSystem,
  CloudflareShellFileSystemOptions,
  CloudflareShellWorkspaceLike,
} from "./contract.ts";

/**
 * Adapt a Cloudflare Shell Workspace to the filesystem contract.
 *
 * Paths outside the allowed roots, inside a deny root, or through a symbolic
 * link are refused.
 */
export function cloudflareShellFileSystem(
  workspace: CloudflareShellWorkspaceLike,
  options: CloudflareShellFileSystemOptions,
): CloudflareShellFileSystem {
  validateWorkspace(workspace);
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("cloudflareShellFileSystem options must be an object");
  }
  const roots = resolveRoots(options);
  const { cwd } = roots;
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes <= 0) {
    throw new TypeError("maxBufferedBytes must be a positive safe integer");
  }
  const id = options.id ?? "cloudflare-shell";
  if (typeof id !== "string" || id === "") throw new TypeError("id must be a non-empty string");

  const refuseSymlinksAlongPath = async (target: string): Promise<CloudflareShellFileInfo> => {
    for (const component of pathsFromSlashToTarget(target)) {
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
    throw refuse(notAFile("directory", cwd, target));
  };

  return Object.freeze({
    id,
    capabilities: Object.freeze({ streaming: false, identity: false }),
    paths: posixPaths,
    cwd,
    allowedRoots: roots.allowedRoots,
    denyRoots: roots.denyRoots,
    symlinks: "reject",
    identity: "none",
    maxBufferedBytes,
    writeCapabilities: SHELL_WRITE_CAPABILITIES,
    ...shellWrites(workspace, roots, maxBufferedBytes),

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      const signal = callOptions.signal;
      if (signal?.aborted) return { ok: false, error: { reason: "aborted" } };

      try {
        const { target } = authorize(roots, requested);
        await refuseSymlinksAlongPath(target);

        const stat = await inspect(workspace, "stat", target);
        if (stat === null) throw refuse({ reason: "not-found" });
        if (stat.type !== "file") {
          throw refuse(notAFile(stat.type === "directory" ? "directory" : "other", cwd, target));
        }
        if (stat.size > maxBufferedBytes) {
          throw refuse({
            reason: "too-large",
            limit: maxBufferedBytes,
            size: stat.size,
            detail: `the object exceeds the ${maxBufferedBytes}-byte buffered ceiling`,
          });
        }

        /* Shell's readFileBytes takes no signal, so abort is checked on both sides. */
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
            reason: "too-large",
            limit: maxBufferedBytes,
            size: bytes.byteLength,
            detail: `the backend returned more than the ${maxBufferedBytes}-byte buffered ceiling`,
          });
        }
        return { ok: true, file: shellOpenFile(workspace, cwd, target, stat, bytes) };
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
        if (stat !== null && stat.type !== "directory") {
          throw refuse({ reason: "not-found", detail: "not a directory" });
        }

        const oneMoreThanLimit = limit + 1;
        const listed = await call(
          workspace.readDir(target, { limit: oneMoreThanLimit, offset: 0 }),
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
  workspace: CloudflareShellWorkspaceLike,
  cwd: string,
  target: string,
  stat: CloudflareShellFileInfo,
  bytes: Uint8Array,
): OpenFile {
  let consumed = false;
  let closed = false;
  return {
    info: {
      resolvedPath: target,
      displayPath: displayPath(cwd, target),
      size: stat.size,
      mtimeMs: stat.updatedAt,
      identity: null,
      mimeType: stat.mimeType ?? null,
      version: shellVersion(stat),
    },
    bytes(): AsyncIterable<Uint8Array> {
      if (consumed) throw new TypeError("shell workspace byte source is single-use");
      consumed = true;
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
