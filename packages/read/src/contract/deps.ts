import type { FileSystem } from "@better-fs-tools/fs";

import type { Classifier } from "./classify.ts";
import type { ReadContext } from "./context.ts";
import type { Clock, Digest } from "./digest.ts";
import type { Formatter } from "./format.ts";
import type { ReadLimits } from "./limits.ts";
import type { MessageCatalog } from "./messages.ts";
import type { ReadStateStore } from "./state.ts";

/** Batch 2 dependencies. Later batches add resolve, suggest, authorize, converters, budget, and hooks. */
export interface Dependencies<THost = undefined> {
  /** A filesystem, or a factory called once for each read after input validation. */
  readonly fs: FileSystem | ((call: ReadContext<THost>) => FileSystem);
  readonly limits: Readonly<ReadLimits>;
  readonly messages: Readonly<MessageCatalog>;
  /** Ordered. First classifier with an opinion wins. Non-empty. */
  readonly classifiers: readonly Classifier[];
  /** A store, or a factory called at most once for each read, and only when the core needs it (D20). */
  readonly state: ReadStateStore | ((call: ReadContext<THost>) => ReadStateStore | null) | null;
  readonly digest: Digest | null;
  readonly clock: Clock;
  readonly formatter: Formatter<THost>;
}

export type ReadToolDeps<THost = undefined> = {
  readonly fs: Dependencies<THost>["fs"];
  readonly limits?: Partial<ReadLimits>;
  readonly messages?: Partial<MessageCatalog>;
} & Partial<Omit<Dependencies<THost>, "fs" | "limits" | "messages">>;
