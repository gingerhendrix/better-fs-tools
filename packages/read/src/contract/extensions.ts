import type { DirectoryEntry, ListOutcome, PathOps } from "@better-fs-tools/fs";

import type { ReadContext } from "./context.ts";
import type { Clock, Digest } from "./digest.ts";
import type { ReadRequest } from "./input.ts";
import type { ReadLimits } from "./limits.ts";
import type { MessageCatalog } from "./messages.ts";
import type { ReadNote } from "./result.ts";

/** Given to every host function that runs during a call. */
export interface HookContext<THost = undefined> {
  readonly request: ReadRequest;
  readonly limits: Readonly<ReadLimits>;
  readonly messages: Readonly<MessageCatalog>;
  readonly digest: Digest | null;
  readonly clock: Clock;
  /** Same object for every stage of one call. */
  readonly call: ReadContext<THost>;
}

/* Resolve */

export interface PathResolver<THost = undefined> {
  readonly id: string;
  resolve(path: string, ctx: ResolveContext<THost>): ResolveOutcome | Promise<ResolveOutcome>;
}

export interface ResolveContext<THost = undefined> extends HookContext<THost> {
  readonly paths: PathOps;
  /** authorize(list) + one bounded fs.list. A second call in the same read returns an error outcome. */
  list(dir: string): Promise<ListOutcome>;
}

export type ResolveOutcome =
  | { readonly kind: "path"; readonly path: string; readonly note?: ReadNote }
  | { readonly kind: "not-found"; readonly note?: ReadNote };

/* Suggest */

export type Suggest<THost = undefined> = (ctx: SuggestContext<THost>) => readonly string[];

export interface SuggestContext<THost = undefined> {
  /** The path that missed. */
  readonly path: string;
  readonly name: string;
  readonly entries: readonly DirectoryEntry[];
  readonly entriesTruncated: boolean;
  /** limits.maxSuggestions. The core also cuts the result to this. */
  readonly max: number;
  readonly call: ReadContext<THost>;
}

/* Authorize */

export interface Authorizer<THost = undefined> {
  readonly id: string;
  authorize(
    target: AuthorizeTarget,
    ctx: HookContext<THost>,
  ): AuthorizeDecision | Promise<AuthorizeDecision>;
}

export interface AuthorizeTarget {
  readonly action: "read" | "list";
  readonly requestedPath: string;
  /** Realpath for "read". Lexical directory path for "list". */
  readonly resolvedPath: string;
  readonly displayPath: string;
  readonly size: number | null;
  readonly mtimeMs: number | null;
}

export type AuthorizeDecision =
  | { readonly allow: true; readonly notes?: readonly ReadNote[] }
  | { readonly allow: false; readonly note?: ReadNote };
