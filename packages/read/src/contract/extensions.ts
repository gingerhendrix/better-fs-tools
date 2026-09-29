import type { DirectoryEntry, ListOutcome, OpenFileInfo } from "@better-fs-tools/fs";

import type { AccessTarget, ToolHookContext, ToolResolveContext } from "./base.ts";
import type { Classification, ClassificationSample } from "./classify.ts";

import type { ReadContext } from "./context.ts";
import type { ReadRequest } from "./input.ts";
import type { ReadLimits } from "./limits.ts";
import type { ReadMessageCatalog } from "./messages.ts";
import type { ContentPart, ReadNote, ReadReport } from "./result.ts";
import type { ReadRecord } from "./state.ts";

/** Given to every host function that runs during a call. */
export interface ReadHookContext<THost = undefined> extends ToolHookContext<THost> {
  readonly tool: "read";
  readonly request: ReadRequest;
  readonly limits: Readonly<ReadLimits>;
  readonly messages: Readonly<ReadMessageCatalog>;
  /** Same object for every stage of one call. */
  readonly call: ReadContext<THost>;
}

/** Given to a resolver. It fits ToolResolveContext, so one resolver works for every tool. */
export interface ReadResolveContext<THost = undefined>
  extends ReadHookContext<THost>, Pick<ToolResolveContext<THost>, "paths" | "list"> {}

export type { PathResolver, ResolveOutcome } from "./base.ts";

export type Suggest<THost = undefined> = (ctx: SuggestContext<THost>) => readonly string[];

export interface SuggestContext<THost = undefined> {
  /** The path that missed. */
  readonly path: string;
  readonly name: string;
  readonly entries: readonly DirectoryEntry[];
  readonly entriesTruncated: boolean;
  /** limits.maxSuggestions. Names past it are dropped. */
  readonly max: number;
  readonly call: ReadContext<THost>;
}

export interface ReadAuthorizer<THost = undefined> {
  readonly id: string;
  // A function property, not a method, so a read authorizer does not fit a write or shell tool.
  readonly authorize: (
    target: ReadAuthorizeTarget,
    ctx: ReadHookContext<THost>,
  ) => ReadAuthorizeDecision | Promise<ReadAuthorizeDecision>;
}

export interface ReadAuthorizeTarget extends AccessTarget {
  readonly action: "read" | "list";
  /** Realpath for "read". Lexical directory path for "list". */
  readonly resolvedPath: string;
  readonly size: number | null;
  readonly mtimeMs: number | null;
}

/** AccessDecision with read notes, so a denial can carry a retry. A ToolAuthorizer's decision fits it. */
export type ReadAuthorizeDecision =
  | { readonly allow: true; readonly notes?: readonly ReadNote[] }
  | { readonly allow: false; readonly note?: ReadNote };

export type Converter<THost = undefined> = FileConverter<THost> | DirectoryConverter<THost>;

export interface ConverterMatch {
  readonly classification: Classification;
  readonly classifier: string;
  readonly sample: ClassificationSample;
}

export interface FileConverter<THost = undefined> {
  readonly id: string;
  readonly target: "file";
  /** Whether this converter handles the match. The only place a converter may decline. */
  accepts(match: ConverterMatch): boolean;
  convert(input: FileConvertInput, ctx: ReadHookContext<THost>): Promise<ConvertOutcome>;
}

export interface FileConvertInput {
  readonly info: Readonly<OpenFileInfo>;
  readonly classification: Classification;
  readonly sample: ClassificationSample;
  /** The whole file from byte 0, capped at limits.maxConvertBytes. Call it once. */
  bytes(): AsyncIterable<Uint8Array>;
}

export interface DirectoryConverter<THost = undefined> {
  readonly id: string;
  readonly target: "directory";
  convert(input: DirectoryConvertInput, ctx: ReadHookContext<THost>): Promise<ConvertOutcome>;
}

export interface DirectoryConvertInput {
  /** Lexical path that open() reported as a directory. */
  readonly path: string;
  readonly target: { readonly resolvedPath: string; readonly displayPath: string } | null;
  /** Authorizes and lists the directory, up to limits.maxDirectoryEntries. Call it once. */
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

export interface ReadHook<THost = undefined> {
  readonly id: string;
  afterRead(outcome: ReadReport, ctx: AfterReadContext<THost>): ReadReport | Promise<ReadReport>;
}

export interface AfterReadContext<THost = undefined> extends ReadHookContext<THost> {
  /** The stored record from before this read. null with no state or no record. */
  readonly previous: ReadRecord | null;
}

export interface ViewBudget {
  readonly id: string;
  /** Cost of one clamped source line. Sync and cheap. */
  measure(text: string): number;
  readonly max: number;
}
