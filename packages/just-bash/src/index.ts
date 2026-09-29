/**
 * Adapt a `just-bash` POSIX filesystem to the `FileSystem` handle contract.
 *
 * `IFileSystem` exposes whole-buffer, path-based operations. This adapter
 * therefore declares `streaming: false`, copies the backend buffer during
 * `open()`, and verifies by repeating canonicalization and stat inspection.
 * It cannot provide the descriptor identity, non-blocking special-file open,
 * or in-flight cancellation guarantees of a descriptor-based Node adapter.
 *
 * Policy remains adapter-owned. Requested paths are checked against virtual
 * roots before the backend is touched and canonical paths are checked again
 * after `realpath()`. Backend errors are reduced to a bounded POSIX code and a
 * safe phase; raw messages, which can contain paths, never leave this module.
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

import type { IdentityMode, SymlinkPolicy } from "@better-fs-tools/fs";

import type { JustBashBackend, JustBashFileSystem, JustBashFileSystemOptions } from "./contract.ts";
import {
  AdapterRefusal,
  authorizeCanonical,
  authorizeRequested,
  backendCall,
  canonicalPath,
  directoryEntry,
  display,
  fingerprint,
  inspect,
  invalid,
  refuse,
  refuseSymlinkComponents,
  requireRegularFile,
  requireStatKey,
  requireWithinCeiling,
  statType,
  toFileSystemError,
  validateDirent,
  validateEntryName,
  validateFileSystem,
  validateOptions,
} from "./policy.ts";
import type { JustBashSettings, ValidatedStat } from "./policy.ts";
import { JUST_BASH_WRITE_CAPABILITIES, justBashWrites } from "./write.ts";

export { justBashCommandRunner } from "./command-runner.ts";
export type { JustBashCommandRunnerOptions, JustBashShell } from "./command-runner.ts";
export type { JustBashBackend, JustBashFileSystem, JustBashFileSystemOptions } from "./contract.ts";

/**
 * Wrap a just-bash `IFileSystem`, or any backend with the `JustBashBackend`
 * subset: the read methods, and the write methods when it writes.
 *
 * Reads are buffered during `open()`. Abort checks bracket every uncancellable
 * backend promise, but cannot stop one already in flight. Directory backends
 * also return complete arrays: `limit` bounds converted output and fallback
 * `lstat()` calls, not backend traversal or allocation.
 *
 * `stat`, `write` and `remove` keep the same roots, deny roots and symlink
 * policy as `open()`. `writeCapabilities` is `{ atomic: false,
 * compareAndSwap: false, preserveMode: true }`. There is no `stage()`. For a
 * read-only view, wrap the result in `readOnlyFileSystem()` from
 * `@better-fs-tools/fs`.
 */
export function justBashFileSystem(
  fs: JustBashBackend,
  options: JustBashFileSystemOptions,
): JustBashFileSystem {
  validateFileSystem(fs);
  const configured = validateOptions(options);
  return Object.freeze({
    ...readMethods(fs, configured),
    writeCapabilities: JUST_BASH_WRITE_CAPABILITIES,
    ...justBashWrites(fs, configured),
  });
}

type ReadMethods = Omit<JustBashFileSystem, "writeCapabilities" | "stat" | "write" | "remove">;

function readMethods(fs: JustBashBackend, configured: JustBashSettings): ReadMethods {
  const { id, cwd, allowedRoots, denyRoots, maxBufferedBytes, identity, symlinks } = configured;

  return {
    id,
    capabilities: Object.freeze({
      streaming: false,
      identity: identity === "required",
    }),
    paths: posixPaths,
    cwd,
    allowedRoots,
    denyRoots,
    maxBufferedBytes,
    identity,
    symlinks,

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      const signal = callOptions.signal;
      if (signal?.aborted) return { ok: false, error: { reason: "aborted" } };

      try {
        const lexical = authorizeRequested(cwd, requested, allowedRoots, denyRoots);
        await inspect(fs, "lstat", lexical, signal);
        if (symlinks === "reject") await refuseSymlinkComponents(fs, lexical, signal);

        const resolved = await canonicalPath(fs, lexical, signal);
        authorizeCanonical(resolved, allowedRoots, denyRoots);

        const before = await inspect(fs, "stat", resolved, signal, "stat-before");
        requireRegularFile(before, cwd, resolved);
        requireWithinCeiling(before.size, maxBufferedBytes, "reported object");
        const beforeKey = requireStatKey(before, identity);

        const backendBytes = await backendCall(
          () => fs.readFileBuffer(resolved),
          "readFileBuffer",
          signal,
        );
        if (!(backendBytes instanceof Uint8Array)) {
          throw invalid("readFileBuffer returned a non-Uint8Array", "readFileBuffer");
        }
        requireWithinCeiling(backendBytes.byteLength, maxBufferedBytes, "returned object");

        /* `InMemoryFs` aliases its stored buffer, so ownership must change here. */
        const bytes = Uint8Array.from(backendBytes);
        const after = await inspect(fs, "stat", resolved, signal, "stat-after");
        requireRegularFile(after, cwd, resolved);

        const afterKey = requireStatKey(after, identity);
        const beforeFingerprint = fingerprint(id, resolved, beforeKey, before);
        const openedFingerprint = fingerprint(id, resolved, afterKey, after);
        if (beforeFingerprint !== openedFingerprint || bytes.byteLength !== after.size) {
          throw refuse({
            reason: "io",
            detail: "the path changed while opening the buffered snapshot",
            cause: { code: "OPEN_CHANGED", phase: "open-verify" },
          });
        }

        return {
          ok: true,
          file: justBashOpenFile({
            fs,
            id,
            cwd,
            lexical,
            resolved,
            allowedRoots,
            denyRoots,
            identity,
            symlinks,
            opened: after,
            openedFingerprint,
            bytes,
            ...(signal === undefined ? {} : { signal }),
          }),
        };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },

    async list(requested: string, listOptions: ListOptions): Promise<ListOutcome> {
      const signal = listOptions.signal;
      if (signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      const { limit } = listOptions;
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        return {
          ok: false,
          error: { reason: "io", detail: "list limit must be a positive safe integer" },
        };
      }

      try {
        const lexical = authorizeRequested(cwd, requested, allowedRoots, denyRoots);
        await inspect(fs, "lstat", lexical, signal);
        if (symlinks === "reject") await refuseSymlinkComponents(fs, lexical, signal);
        const resolved = await canonicalPath(fs, lexical, signal);
        authorizeCanonical(resolved, allowedRoots, denyRoots);
        const stat = await inspect(fs, "stat", resolved, signal);
        /* Same rule as memoryFileSystem: listing a non-directory is not-found. */
        if (!stat.isDirectory) throw refuse({ reason: "not-found", detail: "not a directory" });

        /*
         * Both methods allocate a complete backend array. Slicing bounds only
         * returned entries and, on the fallback path, child metadata calls.
         */
        if (typeof fs.readdirWithFileTypes === "function") {
          const readdirWithFileTypes = fs.readdirWithFileTypes;
          const raw = await backendCall(
            () => readdirWithFileTypes.call(fs, resolved),
            "readdirWithFileTypes",
            signal,
          );
          if (!Array.isArray(raw)) {
            throw invalid("readdirWithFileTypes returned a non-array", "readdirWithFileTypes");
          }
          const entries: DirectoryEntry[] = [];
          for (const value of raw.slice(0, limit)) {
            if (signal?.aborted) throw refuse({ reason: "aborted" });
            entries.push(directoryEntry(validateDirent(value)));
          }
          return { ok: true, entries, truncated: raw.length > limit };
        }

        const raw = await backendCall(() => fs.readdir(resolved), "readdir", signal);
        if (!Array.isArray(raw)) throw invalid("readdir returned a non-array", "readdir");
        const names = raw.slice(0, limit).map((value) => validateEntryName(value, "readdir"));
        const entries: DirectoryEntry[] = [];
        for (const name of names) {
          const child = resolvePosix(resolved, name);
          if (posixPaths.dirname(child) !== resolved) {
            throw invalid("readdir returned an entry outside the listed directory", "readdir");
          }
          const childStat = await inspect(fs, "lstat", child, signal, "list-lstat");
          entries.push({ name, type: statType(childStat) });
        }
        return { ok: true, entries, truncated: raw.length > limit };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The buffered handle                                                        */
/* -------------------------------------------------------------------------- */

function justBashOpenFile(context: {
  fs: JustBashBackend;
  id: string;
  cwd: string;
  lexical: string;
  resolved: string;
  allowedRoots: readonly string[];
  denyRoots: readonly string[];
  identity: IdentityMode;
  symlinks: SymlinkPolicy;
  opened: ValidatedStat;
  openedFingerprint: string;
  bytes: Uint8Array;
  signal?: AbortSignal;
}): OpenFile {
  let consumed = false;
  let closed = false;

  return {
    info: {
      resolvedPath: context.resolved,
      displayPath: display(context.cwd, context.resolved),
      size: context.bytes.byteLength,
      mtimeMs: context.opened.mtimeMs,
      identity: context.identity === "required" ? context.openedFingerprint : null,
      mimeType: null,
      /* The fingerprint verify() compares. Weak in identity mode "none". */
      version: context.openedFingerprint,
    },

    bytes(): AsyncIterable<Uint8Array> {
      if (consumed) throw new TypeError("just-bash byte source is single-use");
      consumed = true;
      let sent = closed || context.bytes.byteLength === 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<Uint8Array>> {
              if (sent || closed || context.signal?.aborted)
                return { done: true, value: undefined };
              sent = true;
              return { done: false, value: context.bytes };
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
        await inspect(context.fs, "lstat", context.lexical, context.signal, "verify-lstat");
        if (context.symlinks === "reject") {
          try {
            await refuseSymlinkComponents(context.fs, context.lexical, context.signal);
          } catch (error) {
            /* A link that appeared on the path since open is a change. */
            if (error instanceof AdapterRefusal && error.error.reason === "denied") {
              return { ok: true, changed: true };
            }
            throw error;
          }
        }
        const currentResolved = await canonicalPath(
          context.fs,
          context.lexical,
          context.signal,
          "verify-realpath",
        );
        try {
          authorizeCanonical(currentResolved, context.allowedRoots, context.denyRoots);
        } catch (error) {
          if (error instanceof AdapterRefusal) return { ok: true, changed: true };
          throw error;
        }
        if (currentResolved !== context.resolved) return { ok: true, changed: true };

        const current = await inspect(
          context.fs,
          "stat",
          currentResolved,
          context.signal,
          "verify-stat",
        );
        if (!current.isFile) return { ok: true, changed: true };
        const key = requireStatKey(current, context.identity);
        return {
          ok: true,
          changed:
            fingerprint(context.id, context.resolved, key, current) !== context.openedFingerprint,
        };
      } catch (error) {
        const mapped = toFileSystemError(error);
        if (mapped.reason === "not-found") return { ok: true, changed: true };
        return { ok: false, error: mapped };
      }
    },

    async close(): Promise<void> {
      closed = true;
      consumed = true;
    },
  };
}
