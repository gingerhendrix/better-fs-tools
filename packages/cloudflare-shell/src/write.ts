/**
 * Writes over a Shell Workspace.
 *
 * Shell gives no compare-and-swap, no exclusive create and no modes, so the
 * adapter checks the precondition with a fresh `lstat` walk right before each
 * backend call. Another writer can still change the file between that check
 * and the call. `compareAndSwap: false` tells the write core, which then adds
 * its `no-compare-and-swap` note.
 *
 * `writeFileBytes` creates missing parents and follows a leaf symlink by
 * itself. The walk refuses both cases first: a missing parent without
 * `createParents` gives `not-found`, and every symlink on the path gives
 * `denied`, as `open()` does.
 */
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

import type { CloudflareShellFileInfo, CloudflareShellWorkspaceLike } from "./contract.ts";
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
import type { Roots } from "./policy.ts";

export const SHELL_WRITE_CAPABILITIES: WriteCapabilities = Object.freeze({
  /* Objects above the R2 threshold are written in several steps. */
  atomic: false,
  compareAndSwap: false,
  /* Shell has no modes. */
  preserveMode: false,
});

export interface ShellWrites {
  stat(path: string, options?: OpenOptions): Promise<StatOutcome>;
  write(path: string, bytes: Uint8Array, options: WriteOptions): Promise<MutationOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}

type Located =
  | { readonly exists: true; readonly entry: CloudflareShellFileInfo }
  | { readonly exists: false; readonly missingDirectories: readonly string[] };

/** The same token open() reports in info.version. */
export function shellVersion(entry: CloudflareShellFileInfo): string {
  return `shell:${entry.size}:${entry.updatedAt}`;
}

export function shellWrites(
  workspace: CloudflareShellWorkspaceLike,
  roots: Roots,
  maxBufferedBytes: number,
): ShellWrites {
  const { cwd } = roots;
  /**
   * `lstat` every component from `/` down. A symlink anywhere is refused, also
   * above the root.
   * The first missing component ends the walk: it and every component below
   * it are missing. The root and its ancestors must exist.
   */
  const locate = async (root: string, target: string): Promise<Located> => {
    const missing: string[] = [];
    for (const component of components(target)) {
      if (missing.length > 0) {
        missing.push(component);
        continue;
      }
      const entry = await inspect(workspace, "lstat", component);
      if (entry === null) {
        if (containsPosix(component, root)) {
          throw refuse({ reason: "not-found", detail: "the root does not exist" });
        }
        missing.push(component);
        continue;
      }
      if (entry.type === "symlink") {
        throw refuse({
          reason: "denied",
          detail:
            component === target
              ? "the path is a symbolic link and this adapter refuses symlinks"
              : "a path component is a symbolic link and this adapter refuses symlinks",
        });
      }
      if (component === target) {
        if (entry.type !== "file") throw refuse(notAFile("directory", cwd, target));
        return { exists: true, entry };
      }
      if (entry.type !== "directory") {
        throw refuse({ reason: "not-found", detail: "a path component is not a directory" });
      }
    }
    /* The root itself, or "/", is a directory. */
    if (missing.length === 0) throw refuse(notAFile("directory", cwd, target));
    return { exists: false, missingDirectories: missing.slice(0, -1) };
  };

  const fileStat = (target: string, located: Located): FileStat =>
    located.exists
      ? {
          exists: true,
          resolvedPath: target,
          displayPath: display(cwd, target),
          size: located.entry.size,
          mtimeMs: located.entry.updatedAt,
          identity: null,
          version: shellVersion(located.entry),
          mode: null,
          hardLinks: null,
        }
      : {
          exists: false,
          resolvedPath: target,
          displayPath: display(cwd, target),
          missingDirectories: located.missingDirectories,
        };

  /** mkdir each missing parent, outermost first, then check it is a real directory. */
  const makeDirectories = async (
    mkdir: NonNullable<CloudflareShellWorkspaceLike["mkdir"]>,
    directories: readonly string[],
  ): Promise<string[]> => {
    const created: string[] = [];
    for (const directory of directories) {
      await mutate(mkdir(directory, { recursive: true }), "mkdir");
      const entry = await inspect(workspace, "lstat", directory);
      if (entry?.type !== "directory") {
        throw refuse({ reason: "denied", detail: "a created parent is not a directory" });
      }
      created.push(directory);
    }
    return created;
  };

  const mutated = (
    target: string,
    entry: CloudflareShellFileInfo | null,
    created: readonly string[],
  ): MutatedFile => ({
    resolvedPath: target,
    displayPath: display(cwd, target),
    version: entry === null ? null : shellVersion(entry),
    identity: null,
    size: entry?.size ?? null,
    createdDirectories: created,
    atomic: SHELL_WRITE_CAPABILITIES.atomic,
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
        const writeFileBytes = requireMethod(workspace, "writeFileBytes");
        const mkdir = requireMethod(workspace, "mkdir");
        const { root, target } = authorize(roots, requested);
        if (bytes.byteLength > maxBufferedBytes) {
          throw new WriteRefusal({
            reason: "too-large",
            limit: maxBufferedBytes,
            size: bytes.byteLength,
            detail: `the object exceeds the ${maxBufferedBytes}-byte buffered ceiling`,
          });
        }
        const located = await locate(root, target);
        refuseConflict(located, options.precondition);
        if (!located.exists && located.missingDirectories.length > 0 && !options.createParents) {
          throw refuse({ reason: "not-found", detail: "the parent directory does not exist" });
        }
        if (options.signal?.aborted) throw refuse({ reason: "aborted" });

        const created = located.exists
          ? []
          : await makeDirectories(mkdir, located.missingDirectories);
        /* Shell resets the mime type to its default unless it is passed again. */
        const mimeType = located.exists ? located.entry.mimeType : undefined;
        await mutate(
          mimeType === undefined
            ? writeFileBytes(target, bytes)
            : writeFileBytes(target, bytes, mimeType),
          "writeFileBytes",
        );
        const after = await inspect(workspace, "lstat", target);
        if (after?.type !== "file") {
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
        const rm = requireMethod(workspace, "rm");
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

/**
 * Decision W4: a write method is looked up when a write runs. A Workspace
 * without it gives `unsupported` before any backend call. Bound, so a class
 * instance keeps its `this`.
 */
function requireMethod<K extends "writeFileBytes" | "mkdir" | "rm">(
  workspace: CloudflareShellWorkspaceLike,
  method: K,
): NonNullable<CloudflareShellWorkspaceLike[K]> {
  const found = workspace[method];
  if (typeof found !== "function") {
    throw new WriteRefusal({
      reason: "unsupported",
      detail: `the Shell Workspace has no ${method}(), so this backend cannot write`,
    });
  }
  return found.bind(workspace) as NonNullable<CloudflareShellWorkspaceLike[K]>;
}

/** The adapter's own precondition check. Not atomic with the backend call. */
function refuseConflict(located: Located, precondition: Precondition): void {
  switch (precondition.kind) {
    case "absent":
      if (located.exists) throw new WriteRefusal({ reason: "exists" });
      return;
    case "version":
      if (!located.exists || shellVersion(located.entry) !== precondition.version) {
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
 * Await one mutating Workspace call. Shell throws plain errors whose message
 * starts with the POSIX code (`EEXIST: path already exists`), so the code is
 * read from the message when the error has none.
 */
async function mutate<T>(pending: Promise<T>, phase: string): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    const code = mutationCode(error);
    const cause = { code, phase };
    if (code === "EEXIST") throw new WriteRefusal({ reason: "exists", cause });
    if (code === "EROFS") throw new WriteRefusal({ reason: "read-only", cause });
    if (code === "ENOSPC" || code === "EDQUOT") {
      throw new WriteRefusal({ reason: "no-space", cause });
    }
    throw refuse(mapBackendError({ code }, phase));
  }
}

function mutationCode(error: unknown): string {
  const code = boundedCode(error);
  if (code !== "UNKNOWN" || !(error instanceof Error)) return code;
  const match = /^(E[A-Z]{2,12}):/u.exec(String(error.message).slice(0, 64));
  return match?.[1] ?? code;
}

function toMutationError(error: unknown): MutationError {
  if (error instanceof WriteRefusal) return error.error;
  if (error instanceof AdapterRefusal) return error.error;
  return toFileSystemError(error);
}
