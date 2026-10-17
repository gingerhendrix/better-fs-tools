import type { FlexibleSchema, ToolExecutionOptions } from "ai";

import type { ShellResult } from "@better-fs-tools/shell";
import { bashToolDefinition } from "@better-fs-tools/shell/signature";
import type { BashToolDefinitionOptions } from "@better-fs-tools/shell/signature";

import { adaptAiSdkTool, checkOptions } from "./adapt.ts";
import type { AiSdkTool } from "./adapt.ts";

/** Options for createAiSdkBashTool: the options of bashToolDefinition(), plus `contextSchema`. */
export type AiSdkBashToolOptions<C = unknown> = BashToolDefinitionOptions<
  ToolExecutionOptions<C>
> & {
  /** Checks the `toolsContext` entry of this tool. The AI SDK validates the context with it before `execute`. */
  readonly contextSchema?: FlexibleSchema<C>;
};

/** An AI SDK bash tool, assignable to `Tool<JsonObject, ShellResult, C>` from ai 7.0.77. */
export type AiSdkBashTool<C = unknown> = AiSdkTool<ShellResult, C>;

/**
 * Creates an AI SDK bash tool with the options and defaults of
 * createBashTool(). The runner and env are required: this package starts no
 * process and does not read process.env. Use nodeCommandRunner() from
 * @better-fs-tools/node or justBashCommandRunner() from
 * @better-fs-tools/just-bash, and shellEnv() from @better-fs-tools/shell.
 */
export function createAiSdkBashTool<C = unknown>(
  options: AiSdkBashToolOptions<C>,
): AiSdkBashTool<C> {
  checkOptions(options, "AI SDK bash tool");
  const { contextSchema, ...rest } = options;
  return adaptAiSdkTool(bashToolDefinition<ToolExecutionOptions<C>>(rest), contextSchema);
}
