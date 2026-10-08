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
  refuseSymlinkComponents,
  requireRegularFile,
  requireStatKey,
  toFileSystemError,
} from "./policy.ts";
import type { JustBashBackend } from "./contract.ts";
import type { JustBashSettings, ValidatedStat } from "./policy.ts";

export const JUST_BASH_WRITE_CAPABILITIES: WriteCapabilities = Object.freeze({
  compareAndSwap: false,
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

export function justBashWrites(fs: JustBashBackend, settings: JustBashSettings): JustBashWrites {
  const { id, cwd, allowedRoots, denyRoots, maxBufferedBytes, identity, symlinks } = settings;

  const lstatOrNull = async (path: string, signal?: AbortSignal): Promise<ValidatedStat | null> => {
    try {
      return await inspect(fs, "lstat", path, signal);
    } catch (error) {
      if (error instanceof AdapterRefusal && error.error.reason === "not-found") return null;
      throw error;
    }
  };

  const existing = async (resolved: string, signal?: AbortSignal): Promise<Located> => {
    const stat = await inspect(fs, "stat", resolved, signal);
    requireRegularFile(stat, cwd, resolved);
    const version = fingerprint(id, resolved, requireStatKey(stat, identity), stat);
    return { exists: true, resolved, stat, version };
  };

  const locate = async (requested: string, signal?: AbortSignal): Promise<Located> => {
    const lexical = authorizeRequested(cwd, requested, allowedRoots, denyRoots);
    if (symlinks === "reject") await refuseSymlinkComponents(fs, lexical, signal);
    const leaf = await lstatOrNull(lexical, signal);
    if (leaf !== null) {
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
    return locateThroughNearestAncestor(lexical, signal);
  };

  const locateThroughNearestAncestor = async (
    lexical: string,
    signal?: AbortSignal,
  ): Promise<Located> => {
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
          identity: identity === "required" ? located.version : null,
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

  const makeDirectories = async (
    writable: Writable<"mkdir">,
    directories: readonly string[],
  ): Promise<string[]> => {
    const created: string[] = [];
    for (const directory of directories) {
      await mutate(() => writable.mkdir(directory, { recursive: true }), "mkdir");
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
    identity: after?.exists === true && identity === "required" ? after.version : null,
    size: after?.exists === true ? after.stat.size : null,
    createdDirectories: created,
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
        const writable = requireWriteMethods(fs, WRITE_METHODS);
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
        if (options.signal?.aborted) throw refuse({ reason: "aborted" });

        const { resolved } = located;
        const created = located.exists
          ? []
          : await makeDirectories(writable, located.missingDirectories);
        await mutate(() => writable.writeFile(resolved, bytes), "writeFile");
        // InMemoryFs writeFile resets the mode to 0o644.
        const mode = located.exists ? located.stat.mode : options.mode;
        if (mode !== undefined) await mutate(() => writable.chmod(resolved, mode), "chmod");
        if (located.exists) {
          const after = await inspect(fs, "stat", resolved);
          // InMemoryFs keeps mtime for two writes in one millisecond.
          if (after.mtimeMs <= located.stat.mtimeMs) {
            const mtime = new Date(located.stat.mtimeMs + 1);
            await mutate(() => writable.utimes(resolved, mtime, mtime), "utimes");
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
        const writable = requireWriteMethods(fs, ["rm"]);
        const located = await locate(requested, options.signal);
        refuseConflict(located, options.precondition);
        if (!located.exists) throw refuse({ reason: "not-found" });
        if (options.signal?.aborted) throw refuse({ reason: "aborted" });
        await mutate(() => writable.rm(located.resolved), "rm");
        return { ok: true, file: mutated(located.resolved, null, []) };
      } catch (error) {
        return { ok: false, error: toMutationError(error) };
      }
    },
  };
}

const WRITE_METHODS = ["writeFile", "mkdir", "chmod", "utimes"] as const;

function requireWriteMethods<M extends WriteMethod>(
  fs: JustBashBackend,
  methods: readonly M[],
): Writable<M> {
  for (const method of methods) {
    if (typeof fs[method] !== "function") {
      throw new WriteRefusal({
        reason: "unsupported",
        detail: `the IFileSystem has no ${method}(), so this backend cannot write`,
      });
    }
  }
  return fs as Writable<M>;
}

type WriteMethod = "writeFile" | "mkdir" | "chmod" | "utimes" | "rm";

type Writable<M extends WriteMethod> = JustBashBackend & Required<Pick<IFileSystem, M>>;

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

class WriteRefusal extends Error {
  constructor(readonly error: MutationError) {
    super(error.reason);
    this.name = "WriteRefusal";
  }
}

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
