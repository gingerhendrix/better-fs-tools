import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { chmod, link, lstat, mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

import type {
  ExistingFileStat,
  FileStat,
  MutateOptions,
  MutatedFile,
  MutationError,
  MutationOutcome,
  StageOutcome,
  StagedWrite,
  WriteOptions,
} from "@better-fs-tools/fs";

import {
  createModes,
  errorCode,
  fail,
  isMode,
  mapError,
  nodeIdentity,
  notAFile,
} from "./policy.ts";
import type { NodeContext, TargetPaths } from "./policy.ts";
import { nodeStat } from "./stat.ts";

/** The calls that change the disk. Tests swap one to inject a failure. */
export interface NodeWriteIo {
  readonly open: typeof open;
  readonly link: typeof link;
  readonly rename: typeof rename;
  readonly unlink: typeof unlink;
  readonly mkdir: typeof mkdir;
  readonly rmdir: typeof rmdir;
  readonly chmod: typeof chmod;
}

export const NODE_WRITE_IO: NodeWriteIo = Object.freeze({
  open,
  link,
  rename,
  unlink,
  mkdir,
  rmdir,
  chmod,
});

const NO_FOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
const NON_BLOCK = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
const HARD_LINKED = "the file has more than one hard link";

export interface NodeWrites {
  write(path: string, bytes: Uint8Array, options: WriteOptions): Promise<MutationOutcome>;
  stage(path: string, bytes: Uint8Array, options: WriteOptions): Promise<StageOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}

/**
 * write, stage, and remove for nodeFileSystem.
 *
 * stage() checks the path like open(), creates missing parents, and writes the
 * bytes to a 0o600 temp file next to the target: write, chmod to the old mode
 * or the new-file mode (see createModes), then fsync. publish() takes an in-process lock for
 * the real path, checks the precondition against a fresh lstat, and publishes:
 * link() for a create, so a concurrent creator makes it fail with exists, and
 * rename() for a replace. Any failure removes the temp file and the
 * directories stage() created.
 */
export function nodeWrites(context: NodeContext, io: NodeWriteIo = NODE_WRITE_IO): NodeWrites {
  const { config } = context;

  const stage = async (
    requested: string,
    bytes: Uint8Array,
    options: WriteOptions,
  ): Promise<StageOutcome> => {
    if (options.mode !== undefined && !isMode(options.mode)) {
      return fail({ reason: "denied", detail: "mode must be an integer from 0 to 0o7777" });
    }
    const outcome = await nodeStat(context, requested, { signal: options.signal });
    if (!outcome.ok) return outcome;
    const current = outcome.stat;
    const conflict = preconditionConflict(current, options);
    if (conflict !== null) return fail(conflict);
    const target = { resolvedPath: current.resolvedPath, displayPath: current.displayPath };

    if (current.exists && (current.hardLinks ?? 1) > 1) {
      if (config.hardLinks === "refuse") return fail({ reason: "denied", detail: HARD_LINKED });
      return { ok: true, staged: inPlaceStage(target, Uint8Array.from(bytes), options) };
    }

    const created: string[] = [];
    let temp: { readonly path: string; readonly handle: FileHandle } | null = null;
    const cleanup = async () => {
      if (temp !== null) {
        await temp.handle.close().catch(() => {});
        await io.unlink(temp.path).catch(() => {});
        temp = null;
      }
      for (const directory of [...created].reverse()) {
        // rmdir refuses a directory that is not empty, which is the rule.
        await io.rmdir(directory).catch(() => {});
      }
      created.length = 0;
    };

    try {
      if (!current.exists && current.missingDirectories.length > 0) {
        if (!options.createParents) {
          return fail({ reason: "not-found", detail: "the parent directory does not exist" });
        }
        const refused = await createParents(current.missingDirectories, created);
        if (refused !== null) {
          await cleanup();
          return fail(refused);
        }
      }
      const tempPath = tempPathFor(target.resolvedPath);
      const handle = await io.open(
        tempPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NO_FOLLOW,
        0o600,
      );
      temp = { path: tempPath, handle };
      await handle.writeFile(bytes);
      await handle.chmod(
        current.exists && current.mode !== null
          ? current.mode
          : (options.mode ?? createModes(config).file),
      );
      await handle.sync();
      if (options.signal?.aborted) {
        await cleanup();
        return fail({ reason: "aborted" });
      }
    } catch (error) {
      await cleanup();
      return fail(mapMutationError(error, "stage", target));
    }
    const staged = temp as { readonly path: string; readonly handle: FileHandle };
    return {
      ok: true,
      staged: renameStage(target, staged, [...created], options, cleanup),
    };
  };

  /** Creates each missing parent, outermost first, and checks it is a real directory. */
  const createParents = async (
    directories: readonly string[],
    created: string[],
  ): Promise<MutationError | null> => {
    const mode = createModes(config).directory;
    for (const directory of directories) {
      try {
        await io.mkdir(directory, mode);
        created.push(directory);
        // mkdir applies the umask. A configured mode is exact, so set it again.
        await io.chmod(directory, mode);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") return mapMutationError(error, "create-parent");
      }
      const stats = await lstat(directory).catch(() => null);
      if (stats === null || !stats.isDirectory()) {
        return { reason: "denied", detail: "a parent directory changed while it was created" };
      }
    }
    return null;
  };

  const renameStage = (
    target: TargetPaths,
    temp: { readonly path: string; readonly handle: FileHandle },
    createdDirectories: readonly string[],
    options: WriteOptions,
    cleanup: () => Promise<void>,
  ): StagedWrite => {
    let used = false;
    let settled = false;
    return Object.freeze({
      resolvedPath: target.resolvedPath,
      async publish(): Promise<MutationOutcome> {
        if (used || settled) throw new TypeError("node staged write: publish() is single-use");
        used = true;
        const outcome = await withPathLock(target.resolvedPath, async () => {
          try {
            const refused = await publishConflict(target, options);
            if (refused !== null) return fail(refused);
            if (options.precondition.kind === "absent") {
              // link() fails with EEXIST when another creator won the race.
              await io.link(temp.path, target.resolvedPath);
              await io.unlink(temp.path).catch(() => {});
            } else {
              await io.rename(temp.path, target.resolvedPath);
            }
          } catch (error) {
            return fail(mapMutationError(error, "publish", target));
          }
          await syncDirectory(path.dirname(target.resolvedPath));
          const stats = await temp.handle.stat({ bigint: true }).catch(() => null);
          await temp.handle.close().catch(() => {});
          return { ok: true as const, file: mutated(target, stats, createdDirectories, true) };
        });
        settled = true;
        if (!outcome.ok) await cleanup();
        return outcome;
      },
      async discard(): Promise<void> {
        if (settled) return;
        settled = true;
        await cleanup();
      },
    });
  };

  /** The hardLinks "in-place" policy: truncate and write through the existing inode. */
  const inPlaceStage = (
    target: TargetPaths,
    bytes: Uint8Array,
    options: WriteOptions,
  ): StagedWrite => {
    let used = false;
    let settled = false;
    return Object.freeze({
      resolvedPath: target.resolvedPath,
      async publish(): Promise<MutationOutcome> {
        if (used || settled) throw new TypeError("node staged write: publish() is single-use");
        used = true;
        settled = true;
        return withPathLock(target.resolvedPath, async () => {
          let handle: FileHandle;
          try {
            handle = await io.open(target.resolvedPath, constants.O_WRONLY | NO_FOLLOW | NON_BLOCK);
          } catch (error) {
            if (errorCode(error) === "ENOENT" && options.precondition.kind === "version") {
              return fail({ reason: "changed" });
            }
            return fail(mapMutationError(error, "publish", target));
          }
          try {
            const before = await handle.stat({ bigint: true });
            if (!before.isFile()) return fail(notAFile(before, target));
            const { precondition } = options;
            if (precondition.kind === "version" && nodeIdentity(before) !== precondition.version) {
              return fail({ reason: "changed" });
            }
            if (precondition.kind === "absent") return fail({ reason: "exists" });
            await handle.truncate(0);
            await handle.writeFile(bytes);
            await handle.sync();
            const after = await handle.stat({ bigint: true });
            return { ok: true as const, file: mutated(target, after, [], false) };
          } catch (error) {
            return fail(mapMutationError(error, "publish", target));
          } finally {
            await handle.close().catch(() => {});
          }
        });
      },
      async discard(): Promise<void> {
        settled = true;
      },
    });
  };

  /** The precondition and type checks under the lock, against a fresh lstat. */
  const publishConflict = async (
    target: TargetPaths,
    options: WriteOptions,
  ): Promise<MutationError | null> => {
    const current = await lstat(target.resolvedPath, { bigint: true }).catch((error) => {
      if (errorCode(error) === "ENOENT") return null;
      throw error;
    });
    const { precondition } = options;
    if (precondition.kind === "absent") return current === null ? null : { reason: "exists" };
    if (precondition.kind === "version") {
      return current !== null && current.isFile() && nodeIdentity(current) === precondition.version
        ? null
        : { reason: "changed" };
    }
    if (current === null) return null;
    if (current.isSymbolicLink()) {
      return { reason: "denied", detail: "the target became a symbolic link" };
    }
    if (!current.isFile()) return notAFile(current, target);
    if (current.nlink > 1n && config.hardLinks === "refuse") {
      return { reason: "denied", detail: HARD_LINKED };
    }
    return null;
  };

  const write = async (
    requested: string,
    bytes: Uint8Array,
    options: WriteOptions,
  ): Promise<MutationOutcome> => {
    const staged = await stage(requested, bytes, options);
    if (!staged.ok) return staged;
    try {
      return await staged.staged.publish();
    } finally {
      await staged.staged.discard();
    }
  };

  const remove = async (requested: string, options: MutateOptions): Promise<MutationOutcome> => {
    const outcome = await nodeStat(context, requested, { signal: options.signal });
    if (!outcome.ok) return outcome;
    const current = outcome.stat;
    const { precondition } = options;
    if (!current.exists) {
      return fail({ reason: precondition.kind === "version" ? "changed" : "not-found" });
    }
    const conflict = preconditionConflict(current, { precondition });
    if (conflict !== null) return fail(conflict);
    const target = { resolvedPath: current.resolvedPath, displayPath: current.displayPath };
    return withPathLock(target.resolvedPath, async () => {
      try {
        const now = await lstat(target.resolvedPath, { bigint: true });
        if (!now.isFile()) {
          return fail(
            precondition.kind === "version" ? { reason: "changed" } : notAFile(now, target),
          );
        }
        if (precondition.kind === "version" && nodeIdentity(now) !== precondition.version) {
          return fail({ reason: "changed" });
        }
        await io.unlink(target.resolvedPath);
      } catch (error) {
        if (errorCode(error) === "ENOENT" && precondition.kind === "version") {
          return fail({ reason: "changed" });
        }
        return fail(mapMutationError(error, "remove", target));
      }
      await syncDirectory(path.dirname(target.resolvedPath));
      return { ok: true as const, file: mutated(target, null, [], true) };
    });
  };

  return { write, stage, remove };
}

/** The early precondition check on the stat. publish() checks again under the lock. */
function preconditionConflict(
  current: FileStat,
  options: Pick<MutateOptions, "precondition">,
): MutationError | null {
  const { precondition } = options;
  if (precondition.kind === "absent") return current.exists ? { reason: "exists" } : null;
  if (precondition.kind === "version") {
    return current.exists && (current as ExistingFileStat).version === precondition.version
      ? null
      : { reason: "changed" };
  }
  return null;
}

function mutated(
  target: TargetPaths,
  stats: BigIntStats | null,
  createdDirectories: readonly string[],
  atomic: boolean,
): MutatedFile {
  const version = stats === null ? null : nodeIdentity(stats);
  return {
    ...target,
    version,
    identity: version,
    size: stats === null ? null : Number(stats.size),
    createdDirectories,
    atomic,
  };
}

/** `.<name>.<random>.tmp` next to the target. The name part is cut so the result stays short. */
function tempPathFor(resolvedPath: string): string {
  const name = path.basename(resolvedPath).slice(0, 48);
  return path.join(path.dirname(resolvedPath), `.${name}.${randomBytes(6).toString("hex")}.tmp`);
}

/** Makes the rename or unlink durable. Best effort: some filesystems refuse fsync on a directory. */
async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY).catch(
    () => null,
  );
  if (handle === null) return;
  await handle.sync().catch(() => {});
  await handle.close().catch(() => {});
}

const pathLocks = new Map<string, Promise<void>>();

/**
 * Runs `run` after every earlier holder of the same real path. The lock is
 * per process: it orders this module's publishes and removes, not other
 * processes.
 */
async function withPathLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = pathLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => held);
  pathLocks.set(key, tail);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (pathLocks.get(key) === tail) pathLocks.delete(key);
  }
}

/** mapError plus the four mutation reasons of plan section 4.11. */
export function mapMutationError(
  error: unknown,
  phase: string,
  target?: TargetPaths,
): MutationError {
  const code = errorCode(error);
  const cause = { code: code ?? "UNKNOWN", phase };
  switch (code) {
    case "EROFS":
      return { reason: "read-only", cause };
    case "ENOSPC":
    case "EDQUOT":
      return { reason: "no-space", cause };
    case "EEXIST":
      return { reason: "exists", cause };
    default:
      return mapError(error, phase, target);
  }
}
