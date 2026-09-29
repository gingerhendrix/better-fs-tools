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

/** The read tool's dependencies, a state only with a digest, and the signature. */
export type CreateAiSdkReadToolOptions<C = unknown> = ReadToolDeps<ToolExecutionOptions<C>> &
  StateNeedsDigest & {
    /** Default defaultReadSignature(). */
    readonly signature?: ReadSignature;
  };

/** Assignable to Tool<JsonObject, ReadResult, C> from ai 7.0.77. */
export interface AiSdkReadTool<C = unknown> {
  readonly name: string;
  readonly description: string;
  readonly strict: true;
  /** jsonSchema(toStrictSchema(signature.schema, signature.name), { validate }). validate maps null to absent first. validate runs toInput and parseReadInput. */
  readonly inputSchema: Schema<JsonObject>;
  /** read(signature.toInput(fromStrictInput(signature.schema, input)), { signal: abortSignal, callId: toolCallId, host: options }). */
  execute(input: JsonObject, options: ToolExecutionOptions<C>): Promise<ReadResult>;
  toModelOutput(options: { output: ReadResult }): AiSdkToolOutput;
}

/** Builds the core with messages = { ...readSignatureMessages(signature), ...options.messages }. */
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

/**
 * The AI SDK face of a read tool that is already built with the signature's
 * messages. createAiSdkFsTools uses it for the bundle's read tool.
 */
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
          // The core parse checks the canonical input the signature produced.
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
      // The ToolExecutionOptions object itself is the host: no copy, no spread.
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
