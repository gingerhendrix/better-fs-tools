import { jsonSchema } from "ai";
import type { JSONSchema7, Schema, ToolExecutionOptions } from "ai";

import type { JsonObject, StateNeedsDigest, ToolCallContext } from "@better-fs-tools/read";
import {
  createApplyPatchTool,
  createEditTool,
  createWriteTool,
  parseApplyPatchInput,
  parseEditInput,
  parseWriteInput,
  resolveWriteLimits,
} from "@better-fs-tools/write";
import type {
  ApplyPatchToolDeps,
  EditToolDeps,
  MutationResult,
  WriteLimits,
  WriteToolDeps,
} from "@better-fs-tools/write";
import {
  defaultEditSignature,
  defaultPatchSignature,
  defaultWriteSignature,
  writeSignatureMessages,
} from "@better-fs-tools/write/signature";
import type {
  EditSignature,
  MutationSignature,
  PatchSignature,
  WriteSignature,
} from "@better-fs-tools/write/signature";

import { toAiSdkOutput } from "./output.ts";
import type { AiSdkReadOutput } from "./output.ts";
import { fromStrictInput, toStrictSchema } from "./strict.ts";

export interface CreateAiSdkEditToolOptions<C = unknown> extends EditToolDeps<
  ToolExecutionOptions<C>
> {
  /** Default defaultEditSignature({ matchers: options.matchers }). */
  readonly signature?: EditSignature;
}

export interface CreateAiSdkWriteToolOptions<C = unknown> extends WriteToolDeps<
  ToolExecutionOptions<C>
> {
  /** Default defaultWriteSignature(). */
  readonly signature?: WriteSignature;
}

export interface CreateAiSdkApplyPatchToolOptions<C = unknown> extends ApplyPatchToolDeps<
  ToolExecutionOptions<C>
> {
  /** Default defaultPatchSignature(). A grammar on the signature is ignored: AI SDK tools take JSON only. */
  readonly signature?: PatchSignature;
}

/** Assignable to Tool<JsonObject, MutationResult, C> from ai 7.0.77. */
export interface AiSdkMutationTool<C = unknown> {
  readonly name: string;
  readonly description: string;
  readonly strict: true;
  /** jsonSchema(toStrictSchema(signature.schema), { validate }). validate maps null to absent first. validate runs toInput and the core parse. */
  readonly inputSchema: Schema<JsonObject>;
  /** tool(signature.toInput(fromStrictInput(signature.schema, input)), { signal: abortSignal, callId: toolCallId, host: options }). */
  execute(input: JsonObject, options: ToolExecutionOptions<C>): Promise<MutationResult>;
  toModelOutput(options: { output: MutationResult }): AiSdkReadOutput;
}

type Core<C> = (
  input: never,
  ctx: ToolCallContext<ToolExecutionOptions<C>>,
) => Promise<MutationResult>;

/** Builds the core with messages = { ...writeSignatureMessages(signature), ...options.messages }. */
export function createAiSdkEditTool<C = unknown>(
  options: CreateAiSdkEditToolOptions<C> & StateNeedsDigest,
): AiSdkMutationTool<C> {
  checkOptions(options, "edit");
  const { signature: given, ...deps } = options;
  const signature = given ?? defaultEditSignature(matchersOf(deps.matchers));
  const edit = createEditTool<ToolExecutionOptions<C>>(withMessages(deps, signature));
  return adapt(signature, edit, parseEditInput, deps.limits);
}

/** Builds the core with messages = { ...writeSignatureMessages(signature), ...options.messages }. */
export function createAiSdkWriteTool<C = unknown>(
  options: CreateAiSdkWriteToolOptions<C> & StateNeedsDigest,
): AiSdkMutationTool<C> {
  checkOptions(options, "write");
  const { signature = defaultWriteSignature(), ...deps } = options;
  const write = createWriteTool<ToolExecutionOptions<C>>(withMessages(deps, signature));
  return adapt(signature, write, parseWriteInput, deps.limits);
}

/**
 * Builds the core with messages = { ...writeSignatureMessages(signature), ...options.messages }.
 * The AI SDK has no freeform tool input (plan section 10), so the model sends JSON
 * even when the signature has a grammar.
 */
export function createAiSdkApplyPatchTool<C = unknown>(
  options: CreateAiSdkApplyPatchToolOptions<C> & StateNeedsDigest,
): AiSdkMutationTool<C> {
  checkOptions(options, "apply_patch");
  const { signature = defaultPatchSignature(), ...deps } = options;
  const applyPatch = createApplyPatchTool<ToolExecutionOptions<C>>(withMessages(deps, signature));
  return adapt(signature, applyPatch, parseApplyPatchInput, deps.limits);
}

function checkOptions(options: unknown, tool: string): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`AI SDK ${tool} tool options must be an object`);
  }
}

function matchersOf(matchers: EditToolDeps["matchers"]) {
  return matchers === undefined ? {} : { matchers };
}

/** The rest of a paired options type loses the pairing. The options type checked it. */
function withMessages<D extends { readonly messages?: object }>(
  deps: D,
  signature: MutationSignature<unknown>,
): D & StateNeedsDigest {
  return {
    ...deps,
    messages: { ...writeSignatureMessages(signature), ...deps.messages },
  } as D & StateNeedsDigest;
}

function adapt<TInput, C>(
  signature: MutationSignature<TInput>,
  tool: Core<C>,
  parse: (input: TInput, limits: Readonly<WriteLimits>) => unknown,
  limitOverrides: Partial<WriteLimits> | undefined,
): AiSdkMutationTool<C> {
  const limits = resolveWriteLimits(limitOverrides);
  const strict = toStrictSchema(signature.schema);

  return Object.freeze<AiSdkMutationTool<C>>({
    name: signature.name,
    description: signature.description,
    strict: true,
    inputSchema: jsonSchema<JsonObject>(strict as JSONSchema7, {
      validate(model) {
        try {
          const value = fromStrictInput(signature.schema, model);
          // The core parse checks the canonical input the signature produced.
          parse(signature.toInput(value), limits);
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
      return tool(signature.toInput(fromStrictInput(signature.schema, input)) as never, call);
    },
    toModelOutput: ({ output }) => toAiSdkOutput(output),
  });
}
