import { jsonSchema } from "ai";
import type { JSONSchema7, Schema, ToolExecutionOptions } from "ai";

import type { JsonObject, ToolCallContext } from "@better-fs-tools/read";
import { createBashTool, parseBashInput, resolveShellLimits } from "@better-fs-tools/shell";
import type { BashTool, ShellLimits, ShellResult, ShellToolDeps } from "@better-fs-tools/shell";
import { bashSignatureMessages, defaultBashSignature } from "@better-fs-tools/shell/signature";
import type { BashSignature } from "@better-fs-tools/shell/signature";

import { toAiSdkOutput } from "./output.ts";
import type { AiSdkToolOutput } from "./output.ts";
import { fromStrictInput, toStrictSchema } from "./strict.ts";

export type CreateAiSdkBashToolOptions<C = unknown> = ShellToolDeps<ToolExecutionOptions<C>> & {
  /** Default defaultBashSignature({ runner: runner.id, limits }). */
  readonly signature?: BashSignature;
};

/** Assignable to Tool<JsonObject, ShellResult, C> from ai 7.0.77. */
export interface AiSdkBashTool<C = unknown> {
  readonly name: string;
  readonly description: string;
  readonly strict: true;
  /** jsonSchema(toStrictSchema(signature.schema), { validate }). validate maps null to absent first. validate runs toInput and the core parse. */
  readonly inputSchema: Schema<JsonObject>;
  /** bash(signature.toInput(fromStrictInput(signature.schema, input)), { signal: abortSignal, callId: toolCallId, host: options }). */
  execute(input: JsonObject, options: ToolExecutionOptions<C>): Promise<ShellResult>;
  toModelOutput(options: { output: ShellResult }): AiSdkToolOutput;
}

/**
 * Builds the core with messages = { ...bashSignatureMessages(signature),
 * ...options.messages }. The runner and env are required: this package does
 * not start processes and does not read process.env. Use nodeCommandRunner()
 * from @better-fs-tools/node, or justBashCommandRunner() from
 * @better-fs-tools/just-bash, and shellEnv() from @better-fs-tools/shell.
 */
export function createAiSdkBashTool<C = unknown>(
  options: CreateAiSdkBashToolOptions<C>,
): AiSdkBashTool<C> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("AI SDK bash tool options must be an object");
  }
  const { signature: given, ...deps } = options;
  const signature = given ?? defaultAiSdkBashSignature(deps);
  const bash = createBashTool<ToolExecutionOptions<C>>({
    ...deps,
    messages: { ...bashSignatureMessages(signature), ...deps.messages },
  });
  return adaptBashTool(signature, bash, deps.limits);
}

/** defaultBashSignature({ runner: runner.id, limits }), from the options. */
export function defaultAiSdkBashSignature(deps: {
  readonly runner?: ShellToolDeps<never>["runner"];
  readonly limits?: Partial<ShellLimits>;
}): BashSignature {
  const runnerId = typeof deps.runner === "function" ? undefined : deps.runner?.id;
  return defaultBashSignature({
    ...(runnerId === undefined ? {} : { runner: runnerId }),
    ...(deps.limits === undefined ? {} : { limits: deps.limits }),
  });
}

/**
 * The AI SDK face of a bash tool that is already built with the signature's
 * messages. createAiSdkFsTools uses it too.
 */
export function adaptBashTool<C>(
  signature: BashSignature,
  bash: BashTool<ToolExecutionOptions<C>>,
  limitOverrides: Partial<ShellLimits> | undefined,
): AiSdkBashTool<C> {
  const limits = resolveShellLimits(limitOverrides);
  const strict = toStrictSchema(signature.schema);

  return Object.freeze<AiSdkBashTool<C>>({
    name: signature.name,
    description: signature.description,
    strict: true,
    inputSchema: jsonSchema<JsonObject>(strict as JSONSchema7, {
      validate(model) {
        try {
          const value = fromStrictInput(signature.schema, model);
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
      return bash(signature.toInput(fromStrictInput(signature.schema, input)), call);
    },
    toModelOutput: ({ output }) => toAiSdkOutput(output),
  });
}
