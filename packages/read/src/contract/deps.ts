import type { FileSystem } from "@better-fs-tools/fs";

import type { Classifier } from "./classify.ts";
import type { ReadContext } from "./context.ts";
import type { Clock, Digest } from "./digest.ts";
import type {
  ReadAuthorizer,
  Converter,
  PathResolver,
  ReadHook,
  Suggest,
  ViewBudget,
} from "./extensions.ts";
import type { ReadFormatter } from "./format.ts";
import type { ReadLimits } from "./limits.ts";
import type { ReadMessageCatalog } from "./messages.ts";
import type { ReadStateStore } from "./state.ts";

export interface ReadDependencies<THost = undefined> {
  /** A filesystem, or a factory called once for each read before resolve (D19). */
  readonly fs: FileSystem | ((call: ReadContext<THost>) => FileSystem);
  readonly limits: Readonly<ReadLimits>;
  readonly messages: Readonly<ReadMessageCatalog>;
  /** Ordered. First classifier with an opinion wins. Non-empty. */
  readonly classifiers: readonly Classifier[];
  /** Changes the path string that goes into the one fs.open(). null is identity. */
  readonly resolve: PathResolver<THost> | null;
  /** Names for a NOT_FOUND note, from one listing of the parent. null never lists. */
  readonly suggest: Suggest<THost> | null;
  /** Host policy on the open file ("read") and before every listing ("list"). null allows. */
  readonly authorize: ReadAuthorizer<THost> | null;
  /** File converters in order: the first that accepts runs. The first directory converter lists directories. */
  readonly converters: readonly Converter<THost>[];
  /** Stops the view early, at a line boundary, when the next line would pass `max`. null has no budget. */
  readonly budget: ViewBudget | null;
  /** Run in order after verification and before record, for every outcome with a request except ABORTED. */
  readonly hooks: readonly ReadHook<THost>[];
  /** A store, or a factory called at most once for each read, and only when the core needs it (D20). Needs `digest`. */
  readonly state: ReadStateStore | ((call: ReadContext<THost>) => ReadStateStore | null) | null;
  readonly digest: Digest | null;
  readonly clock: Clock;
  readonly formatter: ReadFormatter<THost>;
}

/**
 * `state` needs a `digest`: a stored record names the digest that made it.
 * Every tool factory takes its dependencies intersected with this type, so
 * `state` without `digest` does not type-check. At run time the factory
 * throws TypeError for it.
 */
export type StateNeedsDigest = { readonly state?: null } | { readonly digest: Digest };

export type ReadToolDeps<THost = undefined> = {
  readonly fs: ReadDependencies<THost>["fs"];
  readonly limits?: Partial<ReadLimits>;
  readonly messages?: Partial<ReadMessageCatalog>;
} & Partial<Omit<ReadDependencies<THost>, "fs" | "limits" | "messages">>;
