import type { FileStat, Precondition, WritableFileSystem } from "@better-fs-tools/fs";
import type { ReadRecord, ReadStateStore } from "@better-fs-tools/read";

import type { WriteToolName } from "../contract/context.ts";
import type { PreconditionPolicy } from "../contract/preconditions.ts";
import { AbortStop } from "./abort.ts";
import { isRecord } from "./input.ts";
import type { Loaded } from "./load.ts";
import type { MutationScope } from "./scope.ts";

export interface PreconditionResult {
  readonly precondition: Precondition;
  readonly record: ReadRecord | null;
  readonly mustRematch: boolean;
}

export async function checkPrecondition<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  stat: FileStat,
  loaded: Loaded | null,
  requested: string,
): Promise<PreconditionResult> {
  scope.enter("precondition");
  scope.checkAbort();
  const { preconditions, messages, digest } = scope.deps;
  const tool = scope.tool;
  // Asked for early so a failing state factory stops the call before any commit.
  const store = scope.deps.state === null ? null : scope.stateStore();
  if (!stat.exists || loaded === null) {
    return { precondition: { kind: "absent" }, record: null, mustRematch: false };
  }
  const version: Precondition = { kind: "version", version: loaded.version };
  // With no store, the check is off. The host chose this, so the model is not told.
  if (preconditions.requireRead === "off" || store === null) {
    return { precondition: version, record: null, mustRematch: false };
  }

  const record = await getUsableRecord(scope, store, stat.resolvedPath, digest?.id ?? null);
  if (record === null) {
    throw scope.stop("NOT_READ", messages.notRead({ tool, path: requested, wholeFile: false }));
  }
  if (!record.wholeFileVisible && !partialAllowed(preconditions, tool)) {
    throw scope.stop("NOT_READ", messages.notRead({ tool, path: requested, wholeFile: true }), {
      wholeFile: true,
    });
  }
  if (isFresh(record, loaded, fs.capabilities.identity)) {
    return { precondition: version, record, mustRematch: false };
  }
  if (preconditions.onStale === "reject" || tool === "write") {
    throw scope.stop("STALE", messages.stale({ tool, path: requested }));
  }
  return { precondition: version, record, mustRematch: true };
}

async function getUsableRecord<THost>(
  scope: MutationScope<THost>,
  store: ReadStateStore,
  key: string,
  digestId: string | null,
): Promise<ReadRecord | null> {
  let record: unknown;
  try {
    record = await scope.race(() => store.get(key));
  } catch (error) {
    if (error instanceof AbortStop) throw error;
    // A store is a cache: its failure is a miss.
    return null;
  }
  if (!isRecord(record) || record.schema !== 2) return null;
  if (digestId === null || record.digest !== digestId) return null;
  if (typeof record.wholeFileVisible !== "boolean") return null;
  return record as unknown as ReadRecord;
}

function isFresh(record: ReadRecord, loaded: Loaded, identity: boolean): boolean {
  if (identity && record.version !== null && record.version === loaded.version) return true;
  return record.contentId !== null && record.contentId === loaded.contentId;
}

function partialAllowed(policy: Readonly<PreconditionPolicy>, tool: WriteToolName): boolean {
  if (policy.partialRead === "always") return true;
  if (policy.partialRead === "never") return false;
  return tool === "edit" || tool === "apply_patch";
}
