import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import type { JsonObject, ToolCallContext } from "@better-fs-tools/read";
import {
  applyPatchToolDefinition,
  editToolDefinition,
  writeToolDefinition,
} from "@better-fs-tools/write/signature";
import type {
  ApplyPatchToolDefinitionOptions,
  EditToolDefinitionOptions,
  MutationToolDefinition,
  WriteToolDefinitionOptions,
} from "@better-fs-tools/write/signature";

import { toPiMutationDetails } from "./mutation-details.ts";
import type { PiMutationDetails } from "./mutation-details.ts";
import { toPiPart } from "./parts.ts";
import type { PiContentPart } from "./parts.ts";
import { checkPiOptions, piPrompt, splitPrompt } from "./prompt.ts";
import type { PiPromptOptions } from "./prompt.ts";
import { canonicalArgs, piEditArgs, setRenderArgs } from "./renderers.ts";
import { PI_PATCH_ANNOTATIONS, PI_WRITE_ANNOTATIONS } from "./results.ts";
import type { PiToolAnnotations } from "./results.ts";

type Host = ExtensionContext;

/**
 * Options for createPiEditTool: the options of editToolDefinition(), with the
 * Pi extension context as host, plus the Pi prompt options. `fs` is required.
 */
export type PiEditToolOptions = EditToolDefinitionOptions<Host> & PiPromptOptions;

/** As PiEditToolOptions, for write. */
export type PiWriteToolOptions = WriteToolDefinitionOptions<Host> & PiPromptOptions;

/** As PiEditToolOptions, for apply_patch. */
export type PiApplyPatchToolOptions = ApplyPatchToolDefinitionOptions<Host> & PiPromptOptions;

export interface PiMutationToolResult {
  content: PiContentPart[];
  details: PiMutationDetails | undefined;
  /** true when the change failed (status "error"). Pi then shows the content as an error. */
  isError: boolean;
}

/** Assignable to ToolDefinition<TSchema, PiMutationDetails | undefined> from Pi 1.x. */
export interface PiMutationTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly promptGuidelines: string[];
  /** The JSON Schema of the tool input. */
  readonly parameters: TSchema;
  /** Set when the signature has a grammar. */
  readonly constrainedSampling?: { type: "grammar"; variants: { openai_lark: string } };
  /** destructiveHint: true. idempotentHint is true for write only. */
  readonly annotations: PiToolAnnotations;
  execute(
    toolCallId: string,
    input: JsonObject,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<PiMutationToolResult>;
}

export type PiMutationKind = "edit" | "write" | "apply_patch";

/** Creates a Pi edit tool with the options and defaults of createEditTool(). */
export function createPiEditTool(options: PiEditToolOptions): PiMutationTool {
  checkPiOptions(options, "Pi edit tool");
  const { prompt, rest } = splitPrompt(options);
  return adaptPiMutationTool("edit", editToolDefinition<Host>(rest), prompt);
}

/**
 * Creates a Pi write tool with the options and defaults of createWriteTool().
 * `details` is always undefined, as for Pi's own write.
 */
export function createPiWriteTool(options: PiWriteToolOptions): PiMutationTool {
  checkPiOptions(options, "Pi write tool");
  const { prompt, rest } = splitPrompt(options);
  return adaptPiMutationTool("write", writeToolDefinition<Host>(rest), prompt);
}

/**
 * Creates a Pi apply_patch tool with the options and defaults of
 * createApplyPatchTool(). A signature with a grammar sets constrainedSampling.
 */
export function createPiApplyPatchTool(options: PiApplyPatchToolOptions): PiMutationTool {
  checkPiOptions(options, "Pi apply_patch tool");
  const { prompt, rest } = splitPrompt(options);
  return adaptPiMutationTool("apply_patch", applyPatchToolDefinition<Host>(rest), prompt);
}

export function adaptPiMutationTool<TInput>(
  kind: PiMutationKind,
  definition: MutationToolDefinition<TInput, Host>,
  prompt: PiPromptOptions,
): PiMutationTool {
  const { grammar, signature } = definition;
  const adapted = Object.freeze<PiMutationTool>({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    ...piPrompt(prompt, definition.description),
    parameters: Type.Unsafe(definition.inputSchema),
    annotations: { ...(kind === "write" ? PI_WRITE_ANNOTATIONS : PI_PATCH_ANNOTATIONS) },
    ...(grammar === undefined
      ? {}
      : {
          constrainedSampling: { type: "grammar", variants: { openai_lark: grammar.lark } },
        }),
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      const call: ToolCallContext<Host> = {
        ...(signal === undefined ? {} : { signal }),
        callId: toolCallId,
        host: ctx,
      };
      const result = await definition.execute(input, call);
      return {
        content: result.content.map((part) => toPiPart(part, kind)),
        details: kind === "write" ? undefined : toPiMutationDetails(result),
        isError: result.status === "error",
      };
    },
  });
  // Pi has built-in renderers for edit and write. apply_patch has none.
  if (kind !== "apply_patch") {
    const toPi = kind === "edit" ? piEditArgs : canonicalArgs;
    setRenderArgs(adapted, (args) => signature.toInput(args), toPi);
  }
  return adapted;
}
