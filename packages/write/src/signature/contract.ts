import type { JsonObject } from "@better-fs-tools/read";

import type { ApplyPatchInput, EditInput, WriteInput } from "../contract/input.ts";
import type { WriteCanonicalParam } from "../contract/messages.ts";

/** Adapter level. The core never sees it. */
export interface MutationSignature<TInput> {
  /** Pi name and label. AI SDK ToolSet key. */
  readonly name: string;
  readonly description: string;
  /** Plain JSON Schema with a description on each parameter. */
  readonly schema: JsonObject;
  /** Validates model input and maps it to canonical input. Pure. Throws TypeError that names host parameters. */
  toInput(input: unknown): TInput;
  /**
   * Host name for a canonical parameter, for messages. An empty string means
   * the signature has no such parameter, and messages leave out the advice
   * that names it.
   */
  param(name: WriteCanonicalParam): string;
  /** Set on freeform signatures. Hosts that support grammar tools use it. */
  readonly grammar?: { readonly lark: string };
}

export type EditSignature = MutationSignature<EditInput>;
export type WriteSignature = MutationSignature<WriteInput>;
export type PatchSignature = MutationSignature<ApplyPatchInput>;

export interface MutationSignatureDocs<TParam extends string> {
  readonly name?: string;
  readonly description?: string;
  readonly describe?: Partial<Record<TParam, string>>;
}
