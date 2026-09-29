import type { ReadRecord } from "@better-fs-tools/read";

import type { Committed } from "./hooks.ts";
import type { MutationScope } from "./scope.ts";

export async function recordCommitted<THost>(
  scope: MutationScope<THost>,
  committed: readonly Committed[],
): Promise<void> {
  const { digest, clock } = scope.deps;
  if (digest === null || scope.deps.state === null) return;
  scope.enter("record");
  let store;
  try {
    store = scope.stateStore();
  } catch {
    return;
  }
  if (store === null) return;
  for (const file of committed) {
    const { change } = file;
    const key = change.resolvedPath;
    try {
      const movedFromPath = file.planned.change.movedFrom;
      if (movedFromPath !== null) await store.delete(movedFromPath);
      const after = change.after;
      if (!file.finalStateKnown || after === null) {
        await store.delete(key);
        continue;
      }
      const { version, contentId } = after;
      // Built field by field so nothing from `call` reaches the store.
      const record: ReadRecord = {
        schema: 2,
        origin: "write",
        observationId: digest.hash(JSON.stringify(["write", key, version, contentId])),
        resolvedPath: key,
        identity: file.identity,
        version,
        digest: digest.id,
        contentId,
        viewId: contentId ?? "",
        observedAt: clock().toISOString(),
        wholeFileVisible: wholeFileVisible(file),
        totalsExact: true,
        request: null,
      };
      await store.put(key, record);
    } catch {
      // A store failure is not a write failure.
    }
  }
}

function wholeFileVisible(file: Committed): boolean {
  const { planned } = file;
  if (planned.userModified || planned.rematchedAfterStale || file.rewrittenByHook) return false;
  if (planned.change.tool === "write" || planned.loaded === null) return true;
  return planned.record?.wholeFileVisible ?? false;
}
