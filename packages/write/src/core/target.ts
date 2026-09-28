import type { FileStat, WritableFileSystem } from "@better-fs-tools/fs";

import type { WritePhase } from "../contract/result.ts";
import { AbortStop } from "./abort.ts";
import { isRecord } from "./input.ts";
import { isBackendError, messageOf } from "./outcomes.ts";
import type { MutationScope } from "./scope.ts";

/** One target of a call after resolve. */
export interface Target {
  /** The path the caller sent. Messages name it. */
  readonly requestedPath: string;
  /** The path the resolver returned. The stats use it. */
  readonly path: string;
}

/**
 * fs.stat on a resolved path: roots, type check, and the real path. A typed
 * refusal maps by section 5.11. A throw or a malformed outcome gives IO_ERROR.
 */
export async function statTarget<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  target: Target,
  phase: WritePhase = "stat",
): Promise<FileStat> {
  scope.enter(phase);
  scope.checkAbort();
  const { signal } = scope;
  let outcome: unknown;
  try {
    outcome = await scope.race(() => fs.stat(target.path, signal === undefined ? {} : { signal }));
  } catch (error) {
    if (error instanceof AbortStop) throw error;
    throw ioFailure(scope, target.requestedPath, messageOf(error));
  }
  if (!isRecord(outcome)) throw ioFailure(scope, target.requestedPath, "malformed stat outcome");
  if (outcome.ok === false && isBackendError(outcome.error)) {
    throw scope.backendFailure(target.requestedPath, outcome.error);
  }
  if (outcome.ok !== true || !isFileStat(outcome.stat)) {
    throw ioFailure(scope, target.requestedPath, "malformed stat outcome");
  }
  return outcome.stat;
}

/** Stat again under the lock. A different real path means the target moved: STALE. */
export async function statAgain<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  target: Target,
  first: FileStat,
): Promise<FileStat> {
  const second = await statTarget(scope, fs, target);
  if (second.resolvedPath !== first.resolvedPath) {
    const { messages } = scope.deps;
    throw scope.stop("STALE", messages.stale({ tool: scope.tool, path: target.requestedPath }));
  }
  return second;
}

export function ioFailure<THost>(scope: MutationScope<THost>, path: string | null, detail: string) {
  return scope.stop("IO_ERROR", scope.deps.messages.ioError({ path }), { detail });
}

function isFileStat(value: unknown): value is FileStat {
  if (!isRecord(value) || typeof value.resolvedPath !== "string") return false;
  if (typeof value.displayPath !== "string") return false;
  if (value.exists === false) return Array.isArray(value.missingDirectories);
  return value.exists === true && typeof value.version === "string";
}
