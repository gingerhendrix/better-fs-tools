import type { FileSystem } from "@better-fs-tools/fs";

import type { Classifier } from "./classify.ts";
import type { ReadContext } from "./context.ts";
import type { Clock, Digest } from "./digest.ts";
import type {
  Converter,
  PathResolver,
  ReadAuthorizer,
  ReadHook,
  Suggest,
  ViewBudget,
} from "./extensions.ts";
import type { ReadFormatter } from "./format.ts";
import type { ReadLimits } from "./limits.ts";
import type { ReadMessageCatalog } from "./messages.ts";
import type { ReadStateStore } from "./state.ts";

export interface ReadDependencies<THost = undefined> {
  /** A filesystem, or a factory called once for each read. */
  readonly fs: FileSystem | ((call: ReadContext<THost>) => FileSystem);
  readonly limits: Readonly<ReadLimits>;
  readonly messages: Readonly<ReadMessageCatalog>;
  /** Ordered. First classifier with an opinion wins. Non-empty. */
  readonly classifiers: readonly Classifier[];
  /** Rewrites the requested path before it is opened. null leaves it unchanged. */
  readonly resolve: PathResolver<THost> | null;
  /** Suggests names for a NOT_FOUND note from a listing of the parent directory. null turns suggestions off. */
  readonly suggest: Suggest<THost> | null;
  /** Host access policy for the opened file ("read") and before every listing ("list"). null allows everything. */
  readonly authorize: ReadAuthorizer<THost> | null;
  /** File converters in order: the first that accepts runs. The first directory converter lists directories. */
  readonly converters: readonly Converter<THost>[];
  /** Stops the view early, at a line boundary, when the next line would pass `max`. null has no budget. */
  readonly budget: ViewBudget | null;
  /** Run in order on every outcome that has a request, except ABORTED, before state is recorded. */
  readonly hooks: readonly ReadHook<THost>[];
  /** A store, or a factory called at most once for each read, and only when needed. Needs `digest`. */
  readonly state: ReadStateStore | ((call: ReadContext<THost>) => ReadStateStore | null) | null;
  readonly digest: Digest | null;
  readonly clock: Clock;
  readonly formatter: ReadFormatter<THost>;
}

/**
 * `state` needs a `digest`, because a stored record names the digest that made
 * it. `state` without `digest` does not type-check, and throws TypeError at run
 * time.
 */
export type StateNeedsDigest = { readonly state?: null } | { readonly digest: Digest };

/**
 * The same pairing for a factory with its own default digest, such as the
 * Node and Pi factories. Leave `digest` out to get the default. `digest: null`
 * turns it off, and then `state` must be left out or null.
 */
export type StateNeedsDigestOrDefault =
  | { readonly state?: null; readonly digest: null }
  | { readonly digest?: Digest };

export type ReadToolDeps<THost = undefined> = {
  readonly fs: ReadDependencies<THost>["fs"];
  readonly limits?: Partial<ReadLimits>;
  readonly messages?: Partial<ReadMessageCatalog>;
} & Partial<Omit<ReadDependencies<THost>, "fs" | "limits" | "messages">>;
