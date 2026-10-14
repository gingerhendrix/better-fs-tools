import type { Context } from "@earendil-works/chord/context";
import { defineDocFamily } from "@earendil-works/pi-durable";
import type { ConversationId, JsonObject, ToolExecutionApi } from "@earendil-works/pi-durable";

import type { ReadRecord, ReadStateStore } from "@better-fs-tools/read";

/** One read record. `record` is null after a delete. A type alias, so it fits JsonObject. */
export type ReadStateDocument = { record: JsonObject | null };

/**
 * The read records of a conversation: one document for each path, keyed by
 * the environment id and the real path. A fork starts with the records that
 * its parent had at the fork entry, so a model in the fork can change only
 * what that history read.
 */
export const ReadStateDoc = defineDocFamily<ReadStateDocument, null>({
  kind: "better-fs-tools.read-state",
  version: 1,
  family: true,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ record: null }),
});

/** The parts of the tool API that the store uses. */
export type ReadStoreApi = Pick<ToolExecutionApi, "commit" | "snapshot" | "conversationId">;

/**
 * A read store in the conversation's ReadStateDoc documents, for one tool
 * call. It stays after a restart, so an edit after a crash needs no new read.
 * `envId` keeps the records of two environments apart.
 */
export function documentReadStore(
  api: ReadStoreApi,
  envId: string,
  context: Context,
): ReadStateStore {
  const conversationId: ConversationId = api.conversationId;
  const keyOf = (key: string): string => {
    if (typeof key !== "string" || key === "") {
      throw new TypeError("store key must be a non-empty string");
    }
    return `${envId}:${key}`;
  };
  const write = (key: string, record: JsonObject | null): Promise<void> =>
    api.commit(async (tx) => {
      const doc = await tx.doc(ReadStateDoc, conversationId, keyOf(key), null);
      doc.record = record;
    }, context);
  return Object.freeze<ReadStateStore>({
    async get(key) {
      const doc = await api.snapshot(ReadStateDoc, conversationId, keyOf(key), context);
      return (doc?.record ?? null) as ReadRecord | null;
    },
    put: (key, record) => write(key, record as unknown as JsonObject),
    delete: (key) => write(key, null),
  });
}
