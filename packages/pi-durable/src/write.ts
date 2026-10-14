import type { Context } from "@earendil-works/chord/context";
import type { ExecutionEnv, FileInfo as EnvFileInfo } from "@earendil-works/pi-durable/env";

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

import { fromFileError, notAFile, refuse, toFileSystemError } from "./policy.ts";
import type { Located } from "./policy.ts";

const WRITE_CAPABILITIES: WriteCapabilities = Object.freeze({ compareAndSwap: false });

/** The weak change token of a file: its size and modification time. */
export function envVersion(info: EnvFileInfo): string {
  return `env:${info.size}:${info.mtimeMs}`;
}

export interface EnvWrites {
  readonly writeCapabilities: WriteCapabilities;
  stat(path: string, options?: OpenOptions): Promise<StatOutcome>;
  write(path: string, bytes: Uint8Array, options: WriteOptions): Promise<MutationOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}

type Current = { readonly exists: true; readonly info: EnvFileInfo } | { readonly exists: false };

export function envWrites(
  env: ExecutionEnv,
  contextOf: (signal: AbortSignal | undefined) => Context,
  resolve: (requested: unknown, ctx: Context) => Promise<Located>,
): EnvWrites {
  /** The file at a located path, refusing anything that is not a regular file. */
  const current = async (located: Located, ctx: Context): Promise<Current> => {
    if (!located.exists) return { exists: false };
    const result = await env.fileInfo(located.target, ctx);
    if (!result.ok) {
      if (result.error.code === "not_found") return { exists: false };
      throw refuse(fromFileError(result.error, "fileInfo"));
    }
    if (result.value.kind !== "file") {
      throw refuse(notAFile(result.value.kind === "directory" ? "directory" : "other", located));
    }
    return { exists: true, info: result.value };
  };

  const fileStat = (located: Located, file: Current): FileStat =>
    file.exists
      ? {
          exists: true,
          resolvedPath: located.target,
          displayPath: located.displayPath,
          size: file.info.size,
          mtimeMs: file.info.mtimeMs,
          identity: null,
          version: envVersion(file.info),
          mode: null,
          hardLinks: null,
        }
      : {
          exists: false,
          resolvedPath: located.target,
          displayPath: located.displayPath,
          missingDirectories: located.missingDirectories,
        };

  const mutated = (
    located: Located,
    info: EnvFileInfo | null,
    created: readonly string[],
  ): MutatedFile => ({
    resolvedPath: located.target,
    displayPath: located.displayPath,
    version: info === null ? null : envVersion(info),
    identity: null,
    size: info?.size ?? null,
    createdDirectories: created,
  });

  return {
    writeCapabilities: WRITE_CAPABILITIES,

    async stat(requested: string, options: OpenOptions = {}): Promise<StatOutcome> {
      if (options.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      const ctx = contextOf(options.signal);
      try {
        const located = await resolve(requested, ctx);
        return { ok: true, stat: fileStat(located, await current(located, ctx)) };
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
      const ctx = contextOf(options.signal);
      try {
        const located = await resolve(requested, ctx);
        const file = await current(located, ctx);
        refuseConflict(file, options.precondition);
        const missing = file.exists ? [] : located.missingDirectories;
        if (missing.length > 0 && !options.createParents) {
          throw refuse({ reason: "not-found", detail: "the parent directory does not exist" });
        }
        const created: string[] = [];
        for (const directory of missing) {
          const made = await env.createDir(directory, { recursive: false }, ctx);
          if (!made.ok) throw refuse(fromFileError(made.error, "createDir"));
          created.push(directory);
        }
        if (ctx.abortSignal?.aborted) throw refuse({ reason: "aborted" });
        const written = await env.writeFile(located.target, bytes, ctx);
        if (!written.ok) throw refuse(fromFileError(written.error, "writeFile"));
        const after = await env.fileInfo(located.target, ctx);
        if (!after.ok || after.value.kind !== "file") {
          throw refuse({ reason: "io", detail: "the file was not there after the write" });
        }
        return { ok: true, file: mutated(located, after.value, created) };
      } catch (error) {
        return { ok: false, error: toMutationError(error) };
      }
    },

    async remove(requested: string, options: MutateOptions): Promise<MutationOutcome> {
      if (options.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
      const ctx = contextOf(options.signal);
      try {
        const located = await resolve(requested, ctx);
        const file = await current(located, ctx);
        refuseConflict(file, options.precondition);
        if (!file.exists) throw refuse({ reason: "not-found" });
        if (ctx.abortSignal?.aborted) throw refuse({ reason: "aborted" });
        const removed = await env.remove(located.target, { recursive: false }, ctx);
        if (!removed.ok) throw refuse(fromFileError(removed.error, "remove"));
        return { ok: true, file: mutated(located, null, []) };
      } catch (error) {
        return { ok: false, error: toMutationError(error) };
      }
    },
  };
}

function refuseConflict(file: Current, precondition: Precondition): void {
  switch (precondition.kind) {
    case "absent":
      if (file.exists) throw new WriteRefusal({ reason: "exists" });
      return;
    case "version":
      if (!file.exists || envVersion(file.info) !== precondition.version) {
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

// The environment reports no disk-full or read-only code, so those failures are "io".
function toMutationError(error: unknown): MutationError {
  if (error instanceof WriteRefusal) return error.error;
  return toFileSystemError(error);
}
