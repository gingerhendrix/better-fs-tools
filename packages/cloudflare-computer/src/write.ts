/**
 * Writes over Cloudflare Computer's workspace filesystem.
 *
 * `writeFile` runs in one SQL transaction, so a replace is atomic. It has no
 * version check, so the adapter checks the precondition with a fresh `lstat`
 * walk right before the call, and reports `compareAndSwap: false`. A create
 * uses `exclusive: true`, so two creators cannot both win.
 *
 * `writeFile` sets the mode to `options.mode ?? 0o644` on every call, also on
 * a replace. The adapter passes the mode `lstat` reported, so a replace keeps
 * it (`preserveMode: true`).
 */
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

import type { ComputerFileSystemLike, ComputerStat } from "./contract.ts";
import {
  AdapterRefusal,
  authorize,
  boundedCode,
  components,
  display,
  inspect,
  mapBackendError,
  notAFile,
  refuse,
  toFileSystemError,
} from "./policy.ts";

export const COMPUTER_WRITE_CAPABILITIES: WriteCapabilities = Object.freeze({
  atomic: true,
  compareAndSwap: false,
  preserveMode: true,
});

export interface ComputerWrites {
  stat(path: string, options?: OpenOptions): Promise<StatOutcome>;
  write(path: string, bytes: Uint8Array, options: WriteOptions): Promise<MutationOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}

type Located =
  | { readonly exists: true; readonly entry: ComputerStat }
  | { readonly exists: false; readonly missingDirectories: readonly string[] };

/** The same token open() reports in info.version. */
export function computerVersion(entry: ComputerStat): string {
  return `computer:${entry.size}:${entry.mtime}`;
}

export function computerWrites(workspaceFs: ComputerFileSystemLike, root: string): ComputerWrites {
  /**
   * `lstat` every component from the root down. A symlink anywhere is refused.
   * The first missing component ends the walk: it and every component below
   * it are missing. The root itself must exist.
   */
  const locate = async (target: string): Promise<Located> => {
    const missing: string[] = [];
    for (const component of components(root, target)) {
      if (missing.length > 0) {
        missing.push(component);
        continue;
      }
      const entry = await lstatOrNull(component);
      if (entry === null) {
        if (component === root) {
          throw refuse({ reason: "not-found", detail: "the root does not exist" });
        }
        missing.push(component);
        continue;
      }
      if (entry.isSymbolicLink) {
        throw refuse({
          reason: "denied",
          detail:
            component === target
              ? "the path is a symbolic link and this adapter refuses symlinks"
              : "a path component is a symbolic link and this adapter refuses symlinks",
        });
      }
      if (component === target) {
        if (!entry.isFile) {
          throw refuse(notAFile(entry.isDirectory ? "directory" : "other", root, target));
        }
        return { exists: true, entry };
      }
      if (!entry.isDirectory) {
        throw refuse({ reason: "not-found", detail: "a path component is not a directory" });
      }
    }
    /* The root itself, or "/", is a directory. */
    if (missing.length === 0) throw refuse(notAFile("directory", root, target));
    return { exists: false, missingDirectories: missing.slice(0, -1) };
  };

  /** Computer throws ENOENT for a missing path. */
  const lstatOrNull = async (path: string): Promise<ComputerStat | null> => {
    try {
      return await inspect(workspaceFs, "lstat", path, false);
    } catch (error) {
      if (error instanceof AdapterRefusal && error.error.reason === "not-found") return null;
      throw error;
    }
  };

  const fileStat = (target: string, located: Located): FileStat =>
    located.exists
      ? {
          exists: true,
          resolvedPath: target,
          displayPath: display(root, target),
          size: located.entry.size,
          mtimeMs: located.entry.mtime,
          identity: null,
          version: computerVersion(located.entry),
          mode: located.entry.mode ?? null,
          hardLinks: null,
        }
      : {
          exists: false,
          resolvedPath: target,
          displayPath: display(root, target),
          missingDirectories: located.missingDirectories,
        };

  /** mkdir each missing parent, outermost first, then check it is a real directory. */
  const makeDirectories = async (directories: readonly string[]): Promise<string[]> => {
    const created: string[] = [];
    for (const directory of directories) {
      await mutate(workspaceFs.mkdir(directory, { recursive: true }), "mkdir");
      const entry = await lstatOrNull(directory);
      if (entry?.isDirectory !== true) {
        throw refuse({ reason: "denied", detail: "a created parent is not a directory" });
      }
      created.push(directory);
    }
    return created;
  };

  const mutated = (
    target: string,
    entry: ComputerStat | null,
    created: readonly string[],
  ): MutatedFile => ({
    resolvedPath: target,
    displayPath: display(root, target),
    version: entry === null ? null : computerVersion(entry),
    identity: null,
    size: entry?.size ?? null,
    createdDirectories: created,
    atomic: COMPUTER_WRITE_CAPABILITIES.atomic,
  });

  return {
    async stat(requested: string, options: OpenOptions = {}): Promise<StatOutcome> {
      if (options.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      try {
        const target = authorize(root, requested);
        return { ok: true, stat: fileStat(target, await locate(target)) };
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
        const target = authorize(root, requested);
        const located = await locate(target);
        refuseConflict(located, options.precondition);
        if (!located.exists && located.missingDirectories.length > 0 && !options.createParents) {
          throw refuse({ reason: "not-found", detail: "the parent directory does not exist" });
        }
        if (options.signal?.aborted) throw refuse({ reason: "aborted" });

        const created = located.exists ? [] : await makeDirectories(located.missingDirectories);
        /* A replace passes the old mode back. A create is exclusive for the absent precondition. */
        const mode = located.exists ? located.entry.mode : options.mode;
        await mutate(
          workspaceFs.writeFile(target, bytes, {
            ...(mode === undefined ? {} : { mode }),
            ...(options.precondition.kind === "absent" ? { exclusive: true } : {}),
          }),
          "writeFile",
        );
        const after = await lstatOrNull(target);
        if (after?.isFile !== true) {
          throw refuse({ reason: "io", detail: "the file was not there after the write" });
        }
        return { ok: true, file: mutated(target, after, created) };
      } catch (error) {
        return { ok: false, error: toMutationError(error) };
      }
    },

    async remove(requested: string, options: MutateOptions): Promise<MutationOutcome> {
      if (options.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      try {
        const target = authorize(root, requested);
        const located = await locate(target);
        refuseConflict(located, options.precondition);
        if (!located.exists) throw refuse({ reason: "not-found" });
        if (options.signal?.aborted) throw refuse({ reason: "aborted" });
        await mutate(workspaceFs.rm(target), "rm");
        return { ok: true, file: mutated(target, null, []) };
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
      if (!located.exists || computerVersion(located.entry) !== precondition.version) {
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

/** Await one mutating call. Computer's `WorkspaceFsError` carries a POSIX `code`. */
async function mutate<T>(pending: Promise<T>, phase: string): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    const code = boundedCode(error);
    const cause = { code, phase };
    if (code === "EEXIST") throw new WriteRefusal({ reason: "exists", cause });
    if (code === "EROFS") throw new WriteRefusal({ reason: "read-only", cause });
    if (code === "ENOSPC" || code === "EDQUOT") {
      throw new WriteRefusal({ reason: "no-space", cause });
    }
    throw refuse(mapBackendError(error, phase));
  }
}

function toMutationError(error: unknown): MutationError {
  if (error instanceof WriteRefusal) return error.error;
  if (error instanceof AdapterRefusal) return error.error;
  return toFileSystemError(error);
}
