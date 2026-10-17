import type { FlexibleSchema, ToolExecutionOptions } from "ai";

import type { MutationResult } from "@better-fs-tools/write";
import {
  applyPatchToolDefinition,
  editToolDefinition,
  writeToolDefinition,
} from "@better-fs-tools/write/signature";
import type {
  ApplyPatchToolDefinitionOptions,
  EditToolDefinitionOptions,
  WriteToolDefinitionOptions,
} from "@better-fs-tools/write/signature";

import { adaptAiSdkTool, checkOptions } from "./adapt.ts";
import type { AiSdkTool } from "./adapt.ts";

type Host<C> = ToolExecutionOptions<C>;

interface ContextSchemaOption<C> {
  /** Checks the `toolsContext` entry of this tool. The AI SDK validates the context with it before `execute`. */
  readonly contextSchema?: FlexibleSchema<C>;
}

/** Options for createAiSdkEditTool: the options of editToolDefinition(), plus `contextSchema`. */
export type AiSdkEditToolOptions<C = unknown> = EditToolDefinitionOptions<Host<C>> &
  ContextSchemaOption<C>;

/** Options for createAiSdkWriteTool: the options of writeToolDefinition(), plus `contextSchema`. */
export type AiSdkWriteToolOptions<C = unknown> = WriteToolDefinitionOptions<Host<C>> &
  ContextSchemaOption<C>;

/**
 * Options for createAiSdkApplyPatchTool: the options of
 * applyPatchToolDefinition(), plus `contextSchema`. A grammar on the signature
 * is ignored: AI SDK tools take JSON only.
 */
export type AiSdkApplyPatchToolOptions<C = unknown> = ApplyPatchToolDefinitionOptions<Host<C>> &
  ContextSchemaOption<C>;

/** An AI SDK edit, write, or apply_patch tool, assignable to `Tool<JsonObject, MutationResult, C>` from ai 7.0.77. */
export type AiSdkMutationTool<C = unknown> = AiSdkTool<MutationResult, C>;

/** Creates an AI SDK edit tool with the options and defaults of createEditTool(). */
export function createAiSdkEditTool<C = unknown>(
  options: AiSdkEditToolOptions<C>,
): AiSdkMutationTool<C> {
  checkOptions(options, "AI SDK edit tool");
  const { contextSchema, ...rest } = options;
  return adaptAiSdkTool(editToolDefinition<Host<C>>(rest), contextSchema);
}

/** Creates an AI SDK write tool with the options and defaults of createWriteTool(). */
export function createAiSdkWriteTool<C = unknown>(
  options: AiSdkWriteToolOptions<C>,
): AiSdkMutationTool<C> {
  checkOptions(options, "AI SDK write tool");
  const { contextSchema, ...rest } = options;
  return adaptAiSdkTool(writeToolDefinition<Host<C>>(rest), contextSchema);
}

/**
 * Creates an AI SDK apply_patch tool with the options and defaults of
 * createApplyPatchTool(). The model sends JSON even when the signature has a
 * grammar, because the AI SDK has no freeform tool input.
 */
export function createAiSdkApplyPatchTool<C = unknown>(
  options: AiSdkApplyPatchToolOptions<C>,
): AiSdkMutationTool<C> {
  checkOptions(options, "AI SDK apply_patch tool");
  const { contextSchema, ...rest } = options;
  return adaptAiSdkTool(applyPatchToolDefinition<Host<C>>(rest), contextSchema);
}
