import type { FileStat, Precondition, WritableFileSystem } from "@better-fs-tools/fs";
import type { ReadRecord, ReadStateStore } from "@better-fs-tools/read";

import type { WriteToolName } from "../contract/context.ts";
import type { PreconditionPolicy } from "../contract/preconditions.ts";
import { AbortStop } from "./abort.ts";
import { isRecord } from "./input.ts";
import type { Loaded } from "./load.ts";
import type { MutationScope } from "./scope.ts";

export interface PreconditionResult {
  /** What the commit sends to the backend. */
  readonly precondition: Precondition;
  /** The record that backed the check. null when none was needed or read. */
  readonly record: ReadRecord | null;
  /**
   * true when the record is not fresh and the policy lets the tool rematch
   * (edit and apply_patch with onStale "rematch"). The planner decides.
   */
  readonly stale: boolean;
}

/**
 * The precondition table (section 5.3) for one target. Asks for the store
 * whenever the call has one, so a failing state factory stops the call
 * before any commit, even for a create that only records.
 */
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
  const store = scope.deps.state === null ? null : scope.stateStore();
  if (!stat.exists || loaded === null) {
    return { precondition: { kind: "absent" }, record: null, stale: false };
  }
  const version: Precondition = { kind: "version", version: loaded.version };
  if (preconditions.requireRead === "off")
    return { precondition: version, record: null, stale: false };
  if (store === null) {
    addOffNote(scope, tool);
    return { precondition: version, record: null, stale: false };
  }

  const record = await getRecord(scope, store, stat.resolvedPath, digest?.id ?? null);
  if (record === null) {
    throw scope.stop("NOT_READ", messages.notRead({ tool, path: requested, wholeFile: false }));
  }
  if (!record.wholeFileVisible && !partialAllowed(preconditions, tool)) {
    throw scope.stop("NOT_READ", messages.notRead({ tool, path: requested, wholeFile: true }), {
      wholeFile: true,
    });
  }
  if (isFresh(record, loaded, fs.capabilities.identity)) {
    return { precondition: version, record, stale: false };
  }
  if (preconditions.onStale === "reject" || tool === "write") {
    throw scope.stop("STALE", messages.stale({ tool, path: requested }));
  }
  return { precondition: version, record, stale: true };
}

/**
 * The stored record, or null when the get fails, the record is not schema
 * 2, or another digest made it. A store is a cache: its failure is a miss.
 */
async function getRecord<THost>(
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
    return null;
  }
  if (!isRecord(record) || record.schema !== 2) return null;
  if (digestId === null || record.digest !== digestId) return null;
  if (typeof record.wholeFileVisible !== "boolean") return null;
  return record as unknown as ReadRecord;
}

/** The version matches on a backend with stable identity, or the content hash matches. */
function isFresh(record: ReadRecord, loaded: Loaded, identity: boolean): boolean {
  if (identity && record.version !== null && record.version === loaded.version) return true;
  return record.contentId !== null && record.contentId === loaded.contentId;
}

function partialAllowed(policy: Readonly<PreconditionPolicy>, tool: WriteToolName): boolean {
  if (policy.partialRead === "always") return true;
  if (policy.partialRead === "never") return false;
  return tool === "edit" || tool === "apply_patch";
}

/** The read-before-write-off note, once for each call. */
function addOffNote<THost>(scope: MutationScope<THost>, tool: WriteToolName): void {
  if (scope.notes.some((note) => note.code === "read-before-write-off")) return;
  scope.notes.push({
    code: "read-before-write-off",
    severity: "warning",
    message: scope.deps.messages.readBeforeWriteOff({ tool }),
  });
}
