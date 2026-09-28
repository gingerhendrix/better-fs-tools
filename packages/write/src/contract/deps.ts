import type { WritableFileSystem } from "@better-fs-tools/fs";
import type {
  Classifier,
  Clock,
  Digest,
  PathResolver,
  ReadStateStore,
  ToolCallContext,
} from "@better-fs-tools/read";

import type { Codec } from "./codec.ts";
import type { Guard, WriteAuthorizer, WriteHook } from "./extensions.ts";
import type { WriteFormatter } from "./format.ts";
import type { WriteLimits } from "./limits.ts";
import type { LockManager } from "./locks.ts";
import type { Matcher } from "./matcher.ts";
import type { WriteMessageCatalog } from "./messages.ts";
import type { PreconditionPolicy } from "./preconditions.ts";

export interface WriteDependencies<THost = undefined> {
  /** A filesystem, or a factory called once for each call before resolve. */
  readonly fs: WritableFileSystem | ((call: ToolCallContext<THost>) => WritableFileSystem);
  readonly limits: Readonly<WriteLimits>;
  readonly messages: Readonly<WriteMessageCatalog>;
  /** The read tool's resolvers work here. null is identity. */
  readonly resolve: PathResolver<THost> | null;
  /** Access stage and change stage. null allows. */
  readonly authorize: WriteAuthorizer<THost> | null;
  readonly preconditions: Readonly<PreconditionPolicy>;
  /** The read tool's store. A factory runs at most once for each call. null turns read-before-write off. */
  readonly state: ReadStateStore | ((call: ToolCallContext<THost>) => ReadStateStore | null) | null;
  /** Required when state is set. */
  readonly digest: Digest | null;
  readonly clock: Clock;
  readonly locks: LockManager;
  /** Refuse non-text targets on load. Non-empty. */
  readonly classifiers: readonly Classifier[];
  /** First codec that accepts the sample decodes. Non-empty. */
  readonly codecs: readonly Codec[];
  /** Default defaultGuards(). An empty array turns the guards off. */
  readonly guards: readonly Guard<THost>[];
  readonly hooks: readonly WriteHook<THost>[];
  readonly formatter: WriteFormatter<THost>;
}

export interface EditDependencies<THost = undefined> extends WriteDependencies<THost> {
  /** Ordered. Non-empty. */
  readonly matchers: readonly Matcher[];
}

type ToolDeps<D extends WriteDependencies<never>> = {
  readonly fs: D["fs"];
  readonly limits?: Partial<WriteLimits>;
  readonly messages?: Partial<WriteMessageCatalog>;
  readonly preconditions?: Partial<PreconditionPolicy>;
} & Partial<Omit<D, "fs" | "limits" | "messages" | "preconditions">>;

export type WriteToolDeps<THost = undefined> = ToolDeps<WriteDependencies<THost>>;
export type EditToolDeps<THost = undefined> = ToolDeps<EditDependencies<THost>>;
