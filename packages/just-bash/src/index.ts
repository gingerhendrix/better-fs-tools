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
import type { IFileSystem } from "just-bash";

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
  JustBashFileSystem,
  JustBashIdentityMode,
  JustBashReadFileSystem,
  JustBashReadFileSystemOptions,
  JustBashSymlinkPolicy,
} from "./contract.ts";
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
export type {
  JustBashFileSystem,
  JustBashIdentityMode,
  JustBashReadFileSystem,
  JustBashReadFileSystemOptions,
  JustBashSymlinkPolicy,
} from "./contract.ts";

/**
 * Wrap the exact public `IFileSystem` contract exported by `just-bash`.
 *
 * Reads are buffered during `open()`. Abort checks bracket every uncancellable
 * backend promise, but cannot stop one already in flight. Directory backends
 * also return complete arrays: `limit` bounds converted output and fallback
 * `lstat()` calls, not backend traversal or allocation.
 */
export function justBashReadFileSystem(
  fs: IFileSystem,
  options: JustBashReadFileSystemOptions,
): JustBashReadFileSystem {
  validateFileSystem(fs);
  return Object.freeze(readMethods(fs, validateOptions(options)));
}

/**
 * The same adapter with whole-file writes: `stat`, `write` and `remove` under
 * the same roots, deny roots and symlink policy as `open()`.
 *
 * `writeCapabilities` is `{ atomic: false, compareAndSwap: false,
 * preserveMode: true }`. There is no `stage()`.
 */
export function justBashFileSystem(
  fs: IFileSystem,
  options: JustBashReadFileSystemOptions,
): JustBashFileSystem {
  validateFileSystem(fs, ["writeFile", "mkdir", "rm", "chmod", "utimes"]);
  const configured = validateOptions(options);
  return Object.freeze({
    ...readMethods(fs, configured),
    writeCapabilities: JUST_BASH_WRITE_CAPABILITIES,
    ...justBashWrites(fs, configured),
  });
}

function readMethods(fs: IFileSystem, configured: JustBashSettings): JustBashReadFileSystem {
  const { id, cwd, allowedRoots, denyRoots, maxBufferedBytes, identityMode, symlinkPolicy } =
    configured;

  return {
    id,
    capabilities: Object.freeze({
      streaming: false,
      identity: identityMode === "required",
    }),
    paths: posixPaths,
    cwd,
    allowedRoots,
    denyRoots,
    maxBufferedBytes,
    identityMode,
    symlinkPolicy,

    async open(requested: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> {
      const signal = callOptions.signal;
      if (signal?.aborted) return { ok: false, error: { reason: "aborted" } };

      try {
        const lexical = authorizeRequested(cwd, requested, allowedRoots, denyRoots);
        const leaf = await inspect(fs, "lstat", lexical, signal);
        if (symlinkPolicy === "reject" && leaf.isSymbolicLink) {
          throw refuse({
            reason: "denied",
            detail: "the path is a symbolic link and this adapter refuses it",
          });
        }

        const resolved = await canonicalPath(fs, lexical, signal);
        authorizeCanonical(resolved, allowedRoots, denyRoots);

        const before = await inspect(fs, "stat", resolved, signal, "stat-before");
        requireRegularFile(before, cwd, resolved);
        requireWithinCeiling(before.size, maxBufferedBytes, "reported object");
        const beforeKey = requireStatKey(before, identityMode);

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

        const afterKey = requireStatKey(after, identityMode);
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
            identityMode,
            symlinkPolicy,
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
        const leaf = await inspect(fs, "lstat", lexical, signal);
        if (symlinkPolicy === "reject" && leaf.isSymbolicLink) {
          throw refuse({
            reason: "denied",
            detail: "the path is a symbolic link and this adapter refuses it",
          });
        }
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
  fs: IFileSystem;
  id: string;
  cwd: string;
  lexical: string;
  resolved: string;
  allowedRoots: readonly string[];
  denyRoots: readonly string[];
  identityMode: JustBashIdentityMode;
  symlinkPolicy: JustBashSymlinkPolicy;
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
      identity: context.identityMode === "required" ? context.openedFingerprint : null,
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
        const leaf = await inspect(
          context.fs,
          "lstat",
          context.lexical,
          context.signal,
          "verify-lstat",
        );
        if (context.symlinkPolicy === "reject" && leaf.isSymbolicLink) {
          return { ok: true, changed: true };
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
        const key = requireStatKey(current, context.identityMode);
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
