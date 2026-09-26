import { jsonSchema } from "ai";
import type { JSONSchema7, Schema, ToolExecutionOptions } from "ai";

import { createReadTool, parseReadInput, resolveLimits } from "@better-fs-tools/read";
import type { JsonObject, ReadContext, ReadResult, ReadToolDeps } from "@better-fs-tools/read";
import { defaultSignature, signatureMessages } from "@better-fs-tools/read/signature";
import type { ReadSignature } from "@better-fs-tools/read/signature";

import { toAiSdkOutput } from "./output.ts";
import type { AiSdkReadOutput } from "./output.ts";

export interface CreateAiSdkReadToolOptions<C = unknown> extends ReadToolDeps<
  ToolExecutionOptions<C>
> {
  /** Default defaultSignature(). */
  readonly signature?: ReadSignature;
}

/** Assignable to Tool<JsonObject, ReadResult, C> from ai 7.0.77. */
export interface AiSdkReadTool<C = unknown> {
  readonly name: string;
  readonly description: string;
  readonly strict: true;
  /** jsonSchema(signature.schema, { validate }). validate runs toRead and parseReadInput. */
  readonly inputSchema: Schema<JsonObject>;
  /** read(signature.toRead(input), { signal: abortSignal, callId: toolCallId, host: options }). */
  execute(input: JsonObject, options: ToolExecutionOptions<C>): Promise<ReadResult>;
  toModelOutput(options: { output: ReadResult }): AiSdkReadOutput;
}

/** Builds the core with messages = { ...signatureMessages(signature), ...options.messages }. */
export function createAiSdkReadTool<C = unknown>(
  options: CreateAiSdkReadToolOptions<C>,
): AiSdkReadTool<C> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("AI SDK read tool options must be an object");
  }
  const { signature = defaultSignature(), ...deps } = options;
  const read = createReadTool<ToolExecutionOptions<C>>({
    ...deps,
    messages: { ...signatureMessages(signature), ...deps.messages },
  });
  const limits = resolveLimits(deps.limits);

  return Object.freeze<AiSdkReadTool<C>>({
    name: signature.name,
    description: signature.description,
    strict: true,
    inputSchema: jsonSchema<JsonObject>(signature.schema as JSONSchema7, {
      validate(value) {
        try {
          // The core parse checks the canonical input the signature produced.
          parseReadInput(signature.toRead(value), limits);
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
      const call: ReadContext<ToolExecutionOptions<C>> = {
        ...(execution.abortSignal === undefined ? {} : { signal: execution.abortSignal }),
        callId: execution.toolCallId,
        host: execution,
      };
      return read(signature.toRead(input), call);
    },
    toModelOutput: ({ output }) => toAiSdkOutput(output),
  });
}
