import type { DirectoryEntry, ListOutcome, OpenFileInfo } from "@better-fs-tools/fs";

import type { AccessTarget, ToolHookContext, ToolResolveContext } from "./base.ts";
import type { Classification, ClassificationSample } from "./classify.ts";

import type { ReadContext } from "./context.ts";
import type { ReadRequest } from "./input.ts";
import type { ReadLimits } from "./limits.ts";
import type { MessageCatalog } from "./messages.ts";
import type { ContentPart, ReadNote, ReadOutcome } from "./result.ts";
import type { ReadRecord } from "./state.ts";

/** Given to every host function that runs during a call. */
export interface HookContext<THost = undefined> extends ToolHookContext<THost> {
  readonly tool: "read";
  readonly request: ReadRequest;
  readonly limits: Readonly<ReadLimits>;
  readonly messages: Readonly<MessageCatalog>;
  /** Same object for every stage of one call. */
  readonly call: ReadContext<THost>;
}

/* Resolve */

/**
 * What the core passes to a resolver. It fits ToolResolveContext, the type
 * resolvers take, so a resolver works for every tool.
 */
export interface ResolveContext<THost = undefined>
  extends HookContext<THost>, Pick<ToolResolveContext<THost>, "paths" | "list"> {}

export type { PathResolver, ResolveOutcome } from "./base.ts";

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

export interface AuthorizeTarget extends AccessTarget {
  readonly action: "read" | "list";
  /** Realpath for "read". Lexical directory path for "list". */
  readonly resolvedPath: string;
  readonly size: number | null;
  readonly mtimeMs: number | null;
}

/** AccessDecision with read notes, so a denial can carry a retry. A ToolAuthorizer's decision fits it. */
export type AuthorizeDecision =
  | { readonly allow: true; readonly notes?: readonly ReadNote[] }
  | { readonly allow: false; readonly note?: ReadNote };

/* Converters */

export type Converter<THost = undefined> = FileConverter<THost> | DirectoryConverter<THost>;

export interface ConverterMatch {
  readonly classification: Classification;
  readonly classifier: string;
  readonly sample: ClassificationSample;
}

export interface FileConverter<THost = undefined> {
  readonly id: string;
  readonly target: "file";
  /** Sync. The only place a converter may decline. */
  accepts(match: ConverterMatch): boolean;
  convert(input: FileConvertInput, ctx: HookContext<THost>): Promise<ConvertOutcome>;
}

export interface FileConvertInput {
  readonly info: Readonly<OpenFileInfo>;
  readonly classification: Classification;
  readonly sample: ClassificationSample;
  /** Whole source from byte 0. Counted, hashed, capped at limits.maxConvertBytes. Single use. */
  bytes(): AsyncIterable<Uint8Array>;
}

export interface DirectoryConverter<THost = undefined> {
  readonly id: string;
  readonly target: "directory";
  convert(input: DirectoryConvertInput, ctx: HookContext<THost>): Promise<ConvertOutcome>;
}

export interface DirectoryConvertInput {
  /** Lexical path that open() reported as a directory. */
  readonly path: string;
  readonly target: { readonly resolvedPath: string; readonly displayPath: string } | null;
  /** authorize(list) + one bounded fs.list. Single use. */
  list(): Promise<ListOutcome>;
}

export type ConvertOutcome =
  | {
      readonly kind: "text";
      readonly text: string | AsyncIterable<string>;
      readonly mimeType: string | null;
      readonly notes?: readonly ReadNote[];
    }
  | {
      readonly kind: "media";
      readonly parts: readonly ContentPart[];
      readonly notes?: readonly ReadNote[];
    }
  | { readonly kind: "refuse"; readonly code: string; readonly note: ReadNote };

/* Hooks */

export interface ReadHook<THost = undefined> {
  readonly id: string;
  afterRead(outcome: ReadOutcome, ctx: AfterReadContext<THost>): ReadOutcome | Promise<ReadOutcome>;
}

export interface AfterReadContext<THost = undefined> extends HookContext<THost> {
  /** The stored record from before this read. null with no state or no record. */
  readonly previous: ReadRecord | null;
}

/* Budget */

export interface ViewBudget {
  readonly id: string;
  /** Cost of one clamped source line. Sync and cheap. */
  measure(text: string): number;
  readonly max: number;
}
