import type { ReadMedia, ReadObservation, ReadOk, ReadReport } from "../contract/result.ts";
import type { ReadRecord, ReadStateStore } from "../contract/state.ts";
import type { CallScope } from "./call-scope.ts";
import { isRecord } from "./input.ts";
import { coversLines, joinLineRanges, storedLineRanges } from "./seen-lines.ts";

/**
 * The record step of each read waits for the step before it on the same store
 * and key, so parallel ranged reads of one file all join the stored ranges.
 */
const pending = new WeakMap<ReadStateStore, Map<string, Promise<void>>>();

export async function recordOutcome<THost>(
  scope: CallScope<THost>,
  outcome: ReadReport,
): Promise<void> {
  if (outcome.status !== "ok" && outcome.status !== "media") return;
  const { observation } = outcome;
  const { digest } = scope.deps;
  if (observation === null || digest === null) return;
  const store = scope.stateStore();
  if (store === null) return;
  const key = outcome.file.resolvedPath;
  await inTurn(store, key, async () => {
    try {
      const previous = await sameContentRecord(store, key, digest.id, observation.contentId);
      await store.put(key, toRecord(outcome, observation, digest.id, previous));
    } catch {
      // Session state is a cache: a failing store never fails the read.
    }
  });
}

async function inTurn(store: ReadStateStore, key: string, step: () => Promise<void>) {
  let keys = pending.get(store);
  if (keys === undefined) {
    keys = new Map();
    pending.set(store, keys);
  }
  const before = keys.get(key) ?? Promise.resolve();
  const current = before.then(step);
  keys.set(key, current);
  try {
    await current;
  } finally {
    if (keys.get(key) === current) keys.delete(key);
  }
}

/** The stored record, when it describes the same bytes with the same digest. */
async function sameContentRecord(
  store: ReadStateStore,
  key: string,
  digest: string,
  contentId: string | null,
): Promise<Record<string, unknown> | null> {
  if (contentId === null) return null;
  let record: unknown;
  try {
    record = await store.get(key);
  } catch {
    return null;
  }
  if (!isRecord(record) || record.schema !== 2 || record.digest !== digest) return null;
  return record.contentId === contentId ? record : null;
}

/** Copies fields one by one so nothing from the host `call` reaches the store. */
function toRecord(
  outcome: ReadOk | ReadMedia,
  observation: ReadObservation,
  digest: string,
  previous: Record<string, unknown> | null,
): ReadRecord {
  const { file, request } = outcome;
  const seenLines = joinLineRanges([
    ...storedLineRanges(previous?.seenLines),
    ...(observation.visibleLines === null ? [] : [observation.visibleLines]),
  ]);
  // Media is only returned from a whole source, so its source totals are exact.
  const totalsExact = outcome.status === "ok" ? outcome.totals.exact : true;
  const totalLines = outcome.status === "ok" ? outcome.totals.lines : null;
  const wholeFileVisible =
    observation.wholeFileVisible ||
    previous?.wholeFileVisible === true ||
    (totalsExact && totalLines !== null && coversLines(seenLines, totalLines));
  return {
    schema: 2,
    origin: "read",
    observationId: observation.id,
    resolvedPath: file.resolvedPath,
    identity: file.identity,
    version: file.version,
    digest,
    contentId: observation.contentId,
    viewId: observation.viewId,
    observedAt: observation.observedAt,
    wholeFileVisible,
    seenLines,
    totalsExact,
    request: { offset: request.offset, limit: request.limit },
  };
}
