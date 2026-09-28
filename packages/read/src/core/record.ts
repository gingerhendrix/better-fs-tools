import type { ReadMedia, ReadObservation, ReadOk, ReadReport } from "../contract/result.ts";
import type { ReadRecord } from "../contract/state.ts";
import type { CallScope } from "./call-scope.ts";

/**
 * Stores the observation of an ok or media outcome under its resolved path.
 * Only an outcome with an observation needs the store, so `state(call)` runs
 * only then. An observation exists only with a digest, so the record always
 * names the digest that made it. A failing store never fails the read:
 * session state is a cache.
 */
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
  try {
    await store.put(outcome.file.resolvedPath, toRecord(outcome, observation, digest.id));
  } catch {
    // A store failure is not a read failure.
  }
}

/** Built field by field from the outcome, so nothing from `call` reaches the store. */
function toRecord(
  outcome: ReadOk | ReadMedia,
  observation: ReadObservation,
  digest: string,
): ReadRecord {
  const { file, request } = outcome;
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
    wholeFileVisible: observation.wholeFileVisible,
    // Media is only returned from a whole source, so its source totals are exact.
    totalsExact: outcome.status === "ok" ? outcome.totals.exact : true,
    request: { offset: request.offset, limit: request.limit },
  };
}
