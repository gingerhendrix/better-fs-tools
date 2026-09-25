import type { ReadObservation, ReadOk, ReadOutcome } from "../contract/result.ts";
import type { ReadRecord } from "../contract/state.ts";
import type { CallScope } from "./call-scope.ts";

/**
 * Stores the observation of an ok outcome under its resolved path. Only an ok
 * outcome with an observation needs the store, so `state(call)` runs only
 * then. A failing store never fails the read: session state is a cache.
 */
export async function recordOutcome<THost>(
  scope: CallScope<THost>,
  outcome: ReadOutcome,
): Promise<void> {
  if (outcome.status !== "ok") return;
  const { observation } = outcome;
  if (observation === null) return;
  const store = scope.stateStore();
  if (store === null) return;
  try {
    await store.put(outcome.file.resolvedPath, toRecord(outcome, observation));
  } catch {
    // A store failure is not a read failure.
  }
}

/** Built field by field from the outcome, so nothing from `call` reaches the store. */
function toRecord(outcome: ReadOk, observation: ReadObservation): ReadRecord {
  const { file, totals, request } = outcome;
  return {
    schema: 1,
    observationId: observation.id,
    resolvedPath: file.resolvedPath,
    identity: file.identity,
    contentId: observation.contentId,
    viewId: observation.viewId,
    observedAt: observation.observedAt,
    wholeFileVisible: observation.wholeFileVisible,
    totalsExact: totals.exact,
    request: { offset: request.offset, limit: request.limit },
  };
}
