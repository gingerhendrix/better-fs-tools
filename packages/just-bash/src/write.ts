/**
 * Writes over a `just-bash` `IFileSystem`.
 *
 * `IFileSystem` has no compare-and-swap, no exclusive create and no rename
 * that keeps a target's metadata, so the adapter checks the precondition with
 * a fresh stat right before each backend call and reports
 * `compareAndSwap: false`. A write is `writeFile` followed by `chmod`, so it is
 * not atomic either.
 *
 * Three `InMemoryFs` behaviours shape the code. `writeFile` resets the mode to
 * `0o644`, so a replace calls `chmod` with the old mode. `writeFile` replaces a
 * symbolic link or a directory at the path with a file, so the path is checked
 * first and the write goes to the canonical path. `mtime` has millisecond
 * resolution and two writes in one millisecond keep it, so a replace that
 * leaves `mtime` where it was moves it on by one millisecond with `utimes`.
 * The version then changes on every write through this adapter.
 */
import type { IFileSystem } from "just-bash";

import { posixPaths } from "@better-fs-tools/fs";
import type {
  FileStat,
  MutateOptions,
  MutatedFile,
  MutationError,
  MutationOutcome,
  OpenOptions,
  Precondition,
  StatOutcome,
  WriteCapabilities,
  WriteOptions,
} from "@better-fs-tools/fs";

import {
  AdapterRefusal,
  authorizeCanonical,
  authorizeRequested,
  backendCall,
  canonicalPath,
  display,
  fingerprint,
  inspect,
  refuse,
  requireRegularFile,
  requireStatKey,
  toFileSystemError,
} from "./policy.ts";
import type { JustBashSettings, ValidatedStat } from "./policy.ts";

export const JUST_BASH_WRITE_CAPABILITIES: WriteCapabilities = Object.freeze({
  atomic: false,
  compareAndSwap: false,
  preserveMode: true,
});

export interface JustBashWrites {
  stat(path: string, options?: OpenOptions): Promise<StatOutcome>;
  write(path: string, bytes: Uint8Array, options: WriteOptions): Promise<MutationOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}

type Located =
  | {
      readonly exists: true;
      readonly resolved: string;
      readonly stat: ValidatedStat;
      readonly version: string;
    }
  | {
      readonly exists: false;
      readonly resolved: string;
      readonly missingDirectories: readonly string[];
    };

export function justBashWrites(fs: IFileSystem, settings: JustBashSettings): JustBashWrites {
  const { id, cwd, allowedRoots, denyRoots, maxBufferedBytes, identityMode, symlinkPolicy } =
    settings;

  const lstatOrNull = async (path: string, signal?: AbortSignal): Promise<ValidatedStat | null> => {
    try {
      return await inspect(fs, "lstat", path, signal);
    } catch (error) {
      if (error instanceof AdapterRefusal && error.error.reason === "not-found") return null;
      throw error;
    }
  };

  /** Open's version for a canonical path that holds a regular file. */
  const existing = async (resolved: string, signal?: AbortSignal): Promise<Located> => {
    const stat = await inspect(fs, "stat", resolved, signal);
    requireRegularFile(stat, cwd, resolved);
    const version = fingerprint(id, resolved, requireStatKey(stat, identityMode), stat);
    return { exists: true, resolved, stat, version };
  };

  /**
   * The same checks as `open()`: roots and deny roots on the requested path,
   * a leaf symlink refused under `"reject"`, then `realpath` and the roots
   * again on the canonical path. A missing leaf resolves through its nearest
   * existing ancestor, which must be a directory inside the roots.
   */
  const locate = async (requested: string, signal?: AbortSignal): Promise<Located> => {
    const lexical = authorizeRequested(cwd, requested, allowedRoots, denyRoots);
    const leaf = await lstatOrNull(lexical, signal);
    if (leaf !== null) {
      if (leaf.isSymbolicLink && symlinkPolicy === "reject") {
        throw refuse({
          reason: "denied",
          detail: "the path is a symbolic link and this adapter refuses it",
        });
      }
      let resolved: string;
      try {
        resolved = await canonicalPath(fs, lexical, signal);
      } catch (error) {
        if (error instanceof AdapterRefusal && error.error.reason === "not-found") {
          throw refuse({ reason: "denied", detail: "the path is a dangling symbolic link" });
        }
        throw error;
      }
      authorizeCanonical(resolved, allowedRoots, denyRoots);
      return existing(resolved, signal);
    }

    const missing = [posixPaths.basename(lexical)];
    let ancestor = posixPaths.dirname(lexical);
    while ((await lstatOrNull(ancestor, signal)) === null) {
      if (ancestor === "/") throw refuse({ reason: "not-found", detail: "no ancestor exists" });
      missing.unshift(posixPaths.basename(ancestor));
      ancestor = posixPaths.dirname(ancestor);
    }
    const base = await canonicalPath(fs, ancestor, signal);
    authorizeCanonical(base, allowedRoots, denyRoots);
    if (!(await inspect(fs, "stat", base, signal)).isDirectory) {
      throw refuse({ reason: "not-found", detail: "a path component is not a directory" });
    }
    const paths: string[] = [];
    for (const name of missing) paths.push(posixPaths.join(paths.at(-1) ?? base, name));
    const resolved = paths.at(-1) ?? base;
    authorizeCanonical(resolved, allowedRoots, denyRoots);
    return { exists: false, resolved, missingDirectories: paths.slice(0, -1) };
  };

  const fileStat = (located: Located): FileStat =>
    located.exists
      ? {
          exists: true,
          resolvedPath: located.resolved,
          displayPath: display(cwd, located.resolved),
          size: located.stat.size,
          mtimeMs: located.stat.mtimeMs,
          identity: identityMode === "required" ? located.version : null,
          version: located.version,
          mode: located.stat.mode ?? null,
          hardLinks: null,
        }
      : {
          exists: false,
          resolvedPath: located.resolved,
          displayPath: display(cwd, located.resolved),
          missingDirectories: located.missingDirectories,
        };

  /** mkdir each missing parent, outermost first, then check it is a real directory. */
  const makeDirectories = async (directories: readonly string[]): Promise<string[]> => {
    const created: string[] = [];
    for (const directory of directories) {
      await mutate(() => fs.mkdir(directory, { recursive: true }), "mkdir");
      const entry = await lstatOrNull(directory);
      if (entry?.isDirectory !== true) {
        throw refuse({ reason: "denied", detail: "a created parent is not a directory" });
      }
      created.push(directory);
    }
    return created;
  };

  const mutated = (
    resolved: string,
    after: Located | null,
    created: readonly string[],
  ): MutatedFile => ({
    resolvedPath: resolved,
    displayPath: display(cwd, resolved),
    version: after?.exists === true ? after.version : null,
    identity: after?.exists === true && identityMode === "required" ? after.version : null,
    size: after?.exists === true ? after.stat.size : null,
    createdDirectories: created,
    atomic: JUST_BASH_WRITE_CAPABILITIES.atomic,
  });

  return {
    async stat(requested: string, options: OpenOptions = {}): Promise<StatOutcome> {
      if (options.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      try {
        return { ok: true, stat: fileStat(await locate(requested, options.signal)) };
      } catch (error) {
        return { ok: false, error: toFileSystemError(error) };
      }
    },

    async write(
      requested: string,
      bytes: Uint8Array,
      options: WriteOptions,
    ): Promise<MutationOutcome> {
      if (options.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      try {
        if (bytes.byteLength > maxBufferedBytes) {
          throw new WriteRefusal({
            reason: "too-large",
            limit: maxBufferedBytes,
            size: bytes.byteLength,
            detail: `the object exceeds the ${maxBufferedBytes}-byte buffered ceiling`,
          });
        }
        const located = await locate(requested, options.signal);
        refuseConflict(located, options.precondition);
        if (!located.exists && located.missingDirectories.length > 0 && !options.createParents) {
          throw refuse({ reason: "not-found", detail: "the parent directory does not exist" });
        }
        /* From here on the signal is not checked: a started write finishes. */
        if (options.signal?.aborted) throw refuse({ reason: "aborted" });

        const { resolved } = located;
        const created = located.exists ? [] : await makeDirectories(located.missingDirectories);
        await mutate(() => fs.writeFile(resolved, bytes), "writeFile");
        const mode = located.exists ? located.stat.mode : options.mode;
        if (mode !== undefined) await mutate(() => fs.chmod(resolved, mode), "chmod");
        if (located.exists) {
          const after = await inspect(fs, "stat", resolved);
          if (after.mtimeMs <= located.stat.mtimeMs) {
            const mtime = new Date(located.stat.mtimeMs + 1);
            await mutate(() => fs.utimes(resolved, mtime, mtime), "utimes");
          }
        }
        return { ok: true, file: mutated(resolved, await existing(resolved), created) };
      } catch (error) {
        return { ok: false, error: toMutationError(error) };
      }
    },

    async remove(requested: string, options: MutateOptions): Promise<MutationOutcome> {
      if (options.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      try {
        const located = await locate(requested, options.signal);
        refuseConflict(located, options.precondition);
        if (!located.exists) throw refuse({ reason: "not-found" });
        if (options.signal?.aborted) throw refuse({ reason: "aborted" });
        await mutate(() => fs.rm(located.resolved), "rm");
        return { ok: true, file: mutated(located.resolved, null, []) };
      } catch (error) {
        return { ok: false, error: toMutationError(error) };
      }
    },
  };
}

/** The adapter's own precondition check. Not atomic with the backend call. */
function refuseConflict(located: Located, precondition: Precondition): void {
  switch (precondition.kind) {
    case "absent":
      if (located.exists) throw new WriteRefusal({ reason: "exists" });
      return;
    case "version":
      if (!located.exists || located.version !== precondition.version) {
        throw new WriteRefusal({ reason: "changed" });
      }
      return;
    case "any":
      return;
    default:
      throw refuse({ reason: "io", detail: "unknown precondition" });
  }
}

/** Carries a mutation-only reason out of a helper. Never escapes this module. */
class WriteRefusal extends Error {
  constructor(readonly error: MutationError) {
    super(error.reason);
    this.name = "WriteRefusal";
  }
}

/**
 * Run one mutating backend call. Unlike `backendCall`, it takes no signal: a
 * write that has started is reported as done, not as aborted.
 */
async function mutate<T>(operation: () => Promise<T>, phase: string): Promise<T> {
  try {
    return await backendCall(operation, phase);
  } catch (error) {
    if (!(error instanceof AdapterRefusal)) throw error;
    const code = error.error.cause?.code;
    const cause = { code: code ?? "UNKNOWN", phase };
    if (code === "EEXIST") throw new WriteRefusal({ reason: "exists", cause });
    if (code === "EROFS") throw new WriteRefusal({ reason: "read-only", cause });
    if (code === "ENOSPC" || code === "EDQUOT") {
      throw new WriteRefusal({ reason: "no-space", cause });
    }
    throw error;
  }
}

function toMutationError(error: unknown): MutationError {
  if (error instanceof WriteRefusal) return error.error;
  if (error instanceof AdapterRefusal) return error.error;
  return toFileSystemError(error);
}
