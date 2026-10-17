import { jsonSchema } from "ai";
import type { FlexibleSchema, JSONSchema7, Schema, ToolExecutionOptions } from "ai";

import type { ContentPart, JsonObject, ToolCallContext } from "@better-fs-tools/read";

import { toAiSdkOutput } from "./output.ts";
import type { AiSdkToolOutput } from "./output.ts";
import { fromStrictInput, toStrictSchema } from "./strict.ts";

/** An AI SDK tool, assignable to `Tool<JsonObject, TResult, C>` from ai 7.0.77. */
export interface AiSdkTool<TResult, C = unknown> {
  readonly name: string;
  readonly description: string;
  readonly strict: true;
  /** The strict input schema. A `null` for an optional parameter means absent. */
  readonly inputSchema: Schema<JsonObject>;
  /**
   * The schema of the context that AI SDK passes from `toolsContext`, if set.
   * The field also lets the AI SDK types accept a `toolsContext` entry of type `C`.
   */
  readonly contextSchema?: FlexibleSchema<C>;
  /** Runs the tool. The AI SDK execution options are the call's host. */
  execute(input: JsonObject, options: ToolExecutionOptions<C>): Promise<TResult>;
  toModelOutput(options: { output: TResult }): AiSdkToolOutput;
}

/** The parts of a tool definition that the adapter uses. Every xxxToolDefinition() result fits. */
export interface AiSdkDefinitionSource<TResult, C> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  validate(modelInput: unknown): unknown;
  execute(modelInput: unknown, ctx: ToolCallContext<ToolExecutionOptions<C>>): Promise<TResult>;
}

/**
 * Wraps a tool definition as a strict AI SDK tool. The schema's `validate`
 * hook runs the definition's validate on the input without the strict nulls.
 * Throws TypeError when strict mode cannot express the schema.
 */
export function adaptAiSdkTool<TResult extends { readonly content: readonly ContentPart[] }, C>(
  definition: AiSdkDefinitionSource<TResult, C>,
  contextSchema: FlexibleSchema<C> | undefined,
): AiSdkTool<TResult, C> {
  const schema = definition.inputSchema;
  const strict = toStrictSchema(schema, definition.name);
  return Object.freeze<AiSdkTool<TResult, C>>({
    name: definition.name,
    description: definition.description,
    strict: true,
    inputSchema: jsonSchema<JsonObject>(strict as JSONSchema7, {
      validate(model) {
        try {
          const value = fromStrictInput(schema, model);
          definition.validate(value);
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
      const call: ToolCallContext<ToolExecutionOptions<C>> = {
        ...(execution.abortSignal === undefined ? {} : { signal: execution.abortSignal }),
        callId: execution.toolCallId,
        host: execution,
      };
      return definition.execute(fromStrictInput(schema, input), call);
    },
    toModelOutput: ({ output }) => toAiSdkOutput(output),
    ...(contextSchema === undefined ? {} : { contextSchema }),
  });
}

export function checkOptions(options: unknown, label: string): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${label} options must be an object`);
  }
}
