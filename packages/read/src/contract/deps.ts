import type { FileSystem } from "@better-fs-tools/fs";

import type { Classifier } from "./classify.ts";
import type { ReadContext } from "./context.ts";
import type { Clock, Digest } from "./digest.ts";
import type { PathResolver, Suggest } from "./extensions.ts";
import type { Formatter } from "./format.ts";
import type { ReadLimits } from "./limits.ts";
import type { MessageCatalog } from "./messages.ts";
import type { ReadStateStore } from "./state.ts";

/** Batch 4 dependencies. Later batches add authorize, converters, budget, and hooks. */
export interface Dependencies<THost = undefined> {
  /** A filesystem, or a factory called once for each read before resolve (D19). */
  readonly fs: FileSystem | ((call: ReadContext<THost>) => FileSystem);
  readonly limits: Readonly<ReadLimits>;
  readonly messages: Readonly<MessageCatalog>;
  /** Ordered. First classifier with an opinion wins. Non-empty. */
  readonly classifiers: readonly Classifier[];
  /** Changes the path string that goes into the one fs.open(). null is identity. */
  readonly resolve: PathResolver<THost> | null;
  /** Names for a NOT_FOUND note, from one listing of the parent. null never lists. */
  readonly suggest: Suggest<THost> | null;
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
