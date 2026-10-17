import type { FlexibleSchema, ToolExecutionOptions } from "ai";

import type { ReadResult } from "@better-fs-tools/read";
import { readToolDefinition } from "@better-fs-tools/read/signature";
import type { ReadToolDefinitionOptions } from "@better-fs-tools/read/signature";

import { adaptAiSdkTool, checkOptions } from "./adapt.ts";
import type { AiSdkTool } from "./adapt.ts";

/**
 * Options for createAiSdkReadTool: the options of readToolDefinition(), with
 * the AI SDK execution options as host, plus `contextSchema`.
 */
export type AiSdkReadToolOptions<C = unknown> = ReadToolDefinitionOptions<
  ToolExecutionOptions<C>
> & {
  /** Checks the `toolsContext` entry of this tool. The AI SDK validates the context with it before `execute`. */
  readonly contextSchema?: FlexibleSchema<C>;
};

/** An AI SDK read tool, assignable to `Tool<JsonObject, ReadResult, C>` from ai 7.0.77. */
export type AiSdkReadTool<C = unknown> = AiSdkTool<ReadResult, C>;

/**
 * Creates an AI SDK read tool. It takes every option of createReadTool() with
 * the same defaults, plus `signature` and `contextSchema`.
 */
export function createAiSdkReadTool<C = unknown>(
  options: AiSdkReadToolOptions<C>,
): AiSdkReadTool<C> {
  checkOptions(options, "AI SDK read tool");
  const { contextSchema, ...rest } = options;
  return adaptAiSdkTool(readToolDefinition<ToolExecutionOptions<C>>(rest), contextSchema);
}
