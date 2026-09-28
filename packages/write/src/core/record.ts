import type { ReadRecord } from "@better-fs-tools/read";

import type { Committed } from "./hooks.ts";
import type { MutationScope } from "./scope.ts";

/**
 * Stores a write record (schema 2, origin "write") for each committed file,
 * when there is a store. A file a hook rewrote and the core could not read
 * back has its key deleted instead. A store failure never fails the call.
 * Built field by field, so nothing from `call` reaches the store.
 */
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
    const { change, planned } = file;
    const key = change.resolvedPath;
    try {
      const after = change.after;
      if (!file.known || after === null) {
        await store.delete(key);
        continue;
      }
      const { version, contentId } = after;
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
        wholeFileVisible: wholeFileVisible(planned.change.tool, planned),
        totalsExact: true,
        request: null,
      };
      await store.put(key, record);
    } catch {
      // A store failure is not a write failure.
    }
  }
}

/** write and a patch Add see the whole file. edit and a patch Update keep the previous record's value. */
function wholeFileVisible(tool: string, planned: Committed["planned"]): boolean {
  if (tool === "write" || planned.loaded === null) return true;
  return planned.record?.wholeFileVisible ?? false;
}
