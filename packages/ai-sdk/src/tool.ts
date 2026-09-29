import { jsonSchema } from "ai";
import type { JSONSchema7, Schema, ToolExecutionOptions } from "ai";

import { createReadTool, parseReadInput, resolveReadLimits } from "@better-fs-tools/read";
import type {
  JsonObject,
  ReadContext,
  ReadLimits,
  ReadResult,
  ReadTool,
  ReadToolDeps,
  StateNeedsDigest,
} from "@better-fs-tools/read";
import { defaultReadSignature, readSignatureMessages } from "@better-fs-tools/read/signature";
import type { ReadSignature } from "@better-fs-tools/read/signature";

import { toAiSdkOutput } from "./output.ts";
import type { AiSdkToolOutput } from "./output.ts";
import { fromStrictInput, toStrictSchema } from "./strict.ts";

/** Options for createAiSdkReadTool. A state store requires a digest. */
export type CreateAiSdkReadToolOptions<C = unknown> = ReadToolDeps<ToolExecutionOptions<C>> &
  StateNeedsDigest & {
    /** Defaults to defaultReadSignature(). */
    readonly signature?: ReadSignature;
  };

/** An AI SDK read tool, assignable to `Tool<JsonObject, ReadResult, C>` from ai 7.0.77. */
export interface AiSdkReadTool<C = unknown> {
  readonly name: string;
  readonly description: string;
  readonly strict: true;
  /** The strict input schema. A `null` for an optional parameter means absent. */
  readonly inputSchema: Schema<JsonObject>;
  /** Runs the read. The AI SDK execution options are the call's host. */
  execute(input: JsonObject, options: ToolExecutionOptions<C>): Promise<ReadResult>;
  toModelOutput(options: { output: ReadResult }): AiSdkToolOutput;
}

/** Creates an AI SDK read tool. `options.messages` override the signature's messages. */
export function createAiSdkReadTool<C = unknown>(
  options: CreateAiSdkReadToolOptions<C>,
): AiSdkReadTool<C> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("AI SDK read tool options must be an object");
  }
  const { signature = defaultReadSignature(), ...deps } = options;
  const read = createReadTool<ToolExecutionOptions<C>>({
    ...deps,
    messages: { ...readSignatureMessages(signature), ...deps.messages },
  });
  return adaptReadTool(signature, read, deps.limits);
}

export function adaptReadTool<C>(
  signature: ReadSignature,
  read: ReadTool<ToolExecutionOptions<C>>,
  limitOverrides: Partial<ReadLimits> | undefined,
): AiSdkReadTool<C> {
  const limits = resolveReadLimits(limitOverrides);
  const strict = toStrictSchema(signature.schema, signature.name);

  return Object.freeze<AiSdkReadTool<C>>({
    name: signature.name,
    description: signature.description,
    strict: true,
    inputSchema: jsonSchema<JsonObject>(strict as JSONSchema7, {
      validate(model) {
        try {
          const value = fromStrictInput(signature.schema, model);
          parseReadInput(signature.toInput(value), limits);
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
      const call: ReadContext<ToolExecutionOptions<C>> = {
        ...(execution.abortSignal === undefined ? {} : { signal: execution.abortSignal }),
        callId: execution.toolCallId,
        host: execution,
      };
      return read(signature.toInput(fromStrictInput(signature.schema, input)), call);
    },
    toModelOutput: ({ output }) => toAiSdkOutput(output),
  });
}
