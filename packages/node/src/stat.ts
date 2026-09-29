import { lstat, realpath, stat as statPath } from "node:fs/promises";
import path from "node:path";

import type { FileSystemError, OpenOptions, StatOutcome } from "@better-fs-tools/fs";

import {
  checkRequest,
  checkResolved,
  errorCode,
  fail,
  hasSymlinkComponent,
  mapError,
  nodeIdentity,
  notAFile,
  SYMLINK_REJECTED,
  targetPaths,
} from "./policy.ts";
import type { NodeContext, Roots } from "./policy.ts";

const DANGLING = "the path is a symbolic link whose target does not exist";

export async function nodeStat(
  context: NodeContext,
  requested: string,
  options: OpenOptions = {},
): Promise<StatOutcome> {
  const { config } = context;
  if (options.signal?.aborted) return fail({ reason: "aborted" });
  const checked = checkRequest(config, requested);
  if ("error" in checked) return fail(checked.error);
  const { lexical } = checked;

  let roots: Roots;
  try {
    roots = await context.roots();
  } catch (error) {
    return fail(mapError(error, "root-resolution"));
  }

  let target: string;
  try {
    if (config.symlinks === "reject" && (await hasSymlinkComponent(lexical))) {
      return fail({ reason: "denied", detail: SYMLINK_REJECTED });
    }
    target = await realpath(lexical);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") return fail(mapError(error, "resolve"));
    return statMissingPath(context, roots, lexical);
  }

  const refused = checkResolved(roots, target);
  if (refused !== null) return fail(refused);
  const paths = targetPaths(config.cwd, target);
  try {
    const stats = await lstat(target, { bigint: true });
    if (!stats.isFile()) return fail(notAFile(stats, paths));
    if (stats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      return fail({
        reason: "denied",
        detail: "the reported file size is outside the safe numeric range",
      });
    }
    const version = nodeIdentity(stats);
    return {
      ok: true,
      stat: {
        exists: true,
        ...paths,
        size: Number(stats.size),
        mtimeMs: Number(stats.mtimeNs) / 1_000_000,
        identity: version,
        version,
        mode: Number(stats.mode & 0o7777n),
        hardLinks: Number(stats.nlink),
      },
    };
  } catch (error) {
    return fail(mapError(error, "stat", paths));
  }
}

async function statMissingPath(
  context: NodeContext,
  roots: Roots,
  lexical: string,
): Promise<StatOutcome> {
  const segments: string[] = [];
  let current = lexical;
  for (;;) {
    const unresolvableEntry = await lstat(current).catch(() => null);
    if (unresolvableEntry?.isSymbolicLink()) return fail({ reason: "denied", detail: DANGLING });
    if (unresolvableEntry !== null) {
      return fail({ reason: "io", detail: "the path changed while it was resolved" });
    }
    segments.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) return fail({ reason: "not-found" });
    current = parent;
    let ancestor: string;
    try {
      ancestor = await realpath(current);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      return fail(mapError(error, "resolve"));
    }
    return statMissingUnderAncestor(context, roots, ancestor, segments);
  }
}

async function statMissingUnderAncestor(
  context: NodeContext,
  roots: Roots,
  ancestor: string,
  segments: readonly string[],
): Promise<StatOutcome> {
  const refused: FileSystemError | null = checkResolved(roots, ancestor);
  if (refused !== null) return fail(refused);
  try {
    const stats = await statPath(ancestor);
    if (!stats.isDirectory()) {
      return fail({ reason: "not-found", detail: "a parent is not a directory" });
    }
  } catch (error) {
    return fail(mapError(error, "stat-parent"));
  }
  const resolvedPath = path.join(ancestor, ...segments);
  const deny = checkResolved(roots, resolvedPath);
  if (deny !== null) return fail(deny);
  const missingDirectories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    missingDirectories.push(path.join(ancestor, ...segments.slice(0, index)));
  }
  return {
    ok: true,
    stat: {
      exists: false,
      ...targetPaths(context.config.cwd, resolvedPath),
      missingDirectories,
    },
  };
}
