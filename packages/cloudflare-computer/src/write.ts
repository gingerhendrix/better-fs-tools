import { containsPosix } from "@better-fs-tools/fs";
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

import type { CloudflareComputerFileSystemLike, CloudflareComputerStat } from "./contract.ts";
import {
  AdapterRefusal,
  authorize,
  boundedCode,
  pathsFromSlashToTarget,
  displayPath,
  inspect,
  mapBackendError,
  notAFile,
  refuse,
  toFileSystemError,
} from "./policy.ts";
import type { Roots } from "./policy.ts";

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
  | { readonly exists: true; readonly entry: CloudflareComputerStat }
  | { readonly exists: false; readonly missingDirectories: readonly string[] };

export function computerVersion(entry: CloudflareComputerStat): string {
  return `computer:${entry.size}:${entry.mtime}`;
}

export function computerWrites(
  workspaceFs: CloudflareComputerFileSystemLike,
  roots: Roots,
): ComputerWrites {
  const { cwd } = roots;
  const locate = async (root: string, target: string): Promise<Located> => {
    const missing: string[] = [];
    for (const component of pathsFromSlashToTarget(target)) {
      if (missing.length > 0) {
        missing.push(component);
        continue;
      }
      const entry = await lstatOrNull(component);
      if (entry === null) {
        if (containsPosix(component, root)) {
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
          throw refuse(notAFile(entry.isDirectory ? "directory" : "other", cwd, target));
        }
        return { exists: true, entry };
      }
      if (!entry.isDirectory) {
        throw refuse({ reason: "not-found", detail: "a path component is not a directory" });
      }
    }
    if (missing.length === 0) throw refuse(notAFile("directory", cwd, target));
    return { exists: false, missingDirectories: missing.slice(0, -1) };
  };

  const lstatOrNull = async (path: string): Promise<CloudflareComputerStat | null> => {
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
          displayPath: displayPath(cwd, target),
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
          displayPath: displayPath(cwd, target),
          missingDirectories: located.missingDirectories,
        };

  const makeDirectories = async (
    mkdir: NonNullable<CloudflareComputerFileSystemLike["mkdir"]>,
    directories: readonly string[],
  ): Promise<string[]> => {
    const created: string[] = [];
    for (const directory of directories) {
      await mutate(mkdir(directory, { recursive: true }), "mkdir");
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
    entry: CloudflareComputerStat | null,
    created: readonly string[],
  ): MutatedFile => ({
    resolvedPath: target,
    displayPath: displayPath(cwd, target),
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
        const { root, target } = authorize(roots, requested);
        return { ok: true, stat: fileStat(target, await locate(root, target)) };
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
        const writeFile = requireMethod(workspaceFs, "writeFile");
        const mkdir = requireMethod(workspaceFs, "mkdir");
        const { root, target } = authorize(roots, requested);
        const located = await locate(root, target);
        refuseConflict(located, options.precondition);
        if (!located.exists && located.missingDirectories.length > 0 && !options.createParents) {
          throw refuse({ reason: "not-found", detail: "the parent directory does not exist" });
        }
        if (options.signal?.aborted) throw refuse({ reason: "aborted" });

        const created = located.exists
          ? []
          : await makeDirectories(mkdir, located.missingDirectories);
        /* Computer's writeFile resets the mode on every call unless one is passed. */
        const mode = located.exists ? located.entry.mode : options.mode;
        await mutate(
          writeFile(target, bytes, {
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
        const rm = requireMethod(workspaceFs, "rm");
        const { root, target } = authorize(roots, requested);
        const located = await locate(root, target);
        refuseConflict(located, options.precondition);
        if (!located.exists) throw refuse({ reason: "not-found" });
        if (options.signal?.aborted) throw refuse({ reason: "aborted" });
        await mutate(rm(target), "rm");
        return { ok: true, file: mutated(target, null, []) };
      } catch (error) {
        return { ok: false, error: toMutationError(error) };
      }
    },
  };
}

function requireMethod<K extends "writeFile" | "mkdir" | "rm">(
  workspaceFs: CloudflareComputerFileSystemLike,
  method: K,
): NonNullable<CloudflareComputerFileSystemLike[K]> {
  const found = workspaceFs[method];
  if (typeof found !== "function") {
    throw new WriteRefusal({
      reason: "unsupported",
      detail: `the Computer workspace filesystem has no ${method}(), so this backend cannot write`,
    });
  }
  return found.bind(workspaceFs) as NonNullable<CloudflareComputerFileSystemLike[K]>;
}

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

class WriteRefusal extends Error {
  constructor(readonly error: MutationError) {
    super(error.reason);
    this.name = "WriteRefusal";
  }
}

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
