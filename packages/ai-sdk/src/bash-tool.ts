import { jsonSchema } from "ai";
import type { JSONSchema7, Schema, ToolExecutionOptions } from "ai";

import type { JsonObject, ToolCallContext } from "@better-fs-tools/read";
import { createBashTool, parseBashInput, resolveShellLimits } from "@better-fs-tools/shell";
import type { ShellResult, ShellToolDeps } from "@better-fs-tools/shell";
import { bashSignatureMessages, defaultBashSignature } from "@better-fs-tools/shell/signature";
import type { BashSignature } from "@better-fs-tools/shell/signature";

import { toAiSdkOutput } from "./output.ts";
import type { AiSdkReadOutput } from "./output.ts";

export type CreateAiSdkBashToolOptions<C = unknown> = ShellToolDeps<ToolExecutionOptions<C>> & {
  /** Default defaultBashSignature({ runner: runner.id, limits }). */
  readonly signature?: BashSignature;
};

/** Assignable to Tool<JsonObject, ShellResult, C> from ai 7.0.77. */
export interface AiSdkBashTool<C = unknown> {
  readonly name: string;
  readonly description: string;
  readonly strict: true;
  /** jsonSchema(signature.schema, { validate }). validate runs toInput and the core parse. */
  readonly inputSchema: Schema<JsonObject>;
  /** bash(signature.toInput(input), { signal: abortSignal, callId: toolCallId, host: options }). */
  execute(input: JsonObject, options: ToolExecutionOptions<C>): Promise<ShellResult>;
  toModelOutput(options: { output: ShellResult }): AiSdkReadOutput;
}

/**
 * Builds the core with messages = { ...bashSignatureMessages(signature),
 * ...options.messages }. The runner is required: this package does not
 * start processes. Use nodeCommandRunner() from @better-fs-tools/node, or
 * justBashCommandRunner() from @better-fs-tools/just-bash.
 */
export function createAiSdkBashTool<C = unknown>(
  options: CreateAiSdkBashToolOptions<C>,
): AiSdkBashTool<C> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("AI SDK bash tool options must be an object");
  }
  const { signature: given, ...deps } = options;
  const runnerId = typeof deps.runner === "function" ? undefined : deps.runner?.id;
  const signature =
    given ??
    defaultBashSignature({
      ...(runnerId === undefined ? {} : { runner: runnerId }),
      ...(deps.limits === undefined ? {} : { limits: deps.limits }),
    });
  const bash = createBashTool<ToolExecutionOptions<C>>({
    ...deps,
    messages: { ...bashSignatureMessages(signature), ...deps.messages },
  });
  const limits = resolveShellLimits(deps.limits);

  return Object.freeze<AiSdkBashTool<C>>({
    name: signature.name,
    description: signature.description,
    strict: true,
    inputSchema: jsonSchema<JsonObject>(signature.schema as JSONSchema7, {
      validate(value) {
        try {
          parseBashInput(signature.toInput(value), limits);
          return { success: true, value: value as JsonObject };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      },
    }),
    async execute(input, execution) {
      // The ToolExecutionOptions object itself is the host: no copy, no spread.
      const call: ToolCallContext<ToolExecutionOptions<C>> = {
        ...(execution.abortSignal === undefined ? {} : { signal: execution.abortSignal }),
        callId: execution.toolCallId,
        host: execution,
      };
      return bash(signature.toInput(input), call);
    },
    toModelOutput: ({ output }) => toAiSdkOutput(output),
  });
}
