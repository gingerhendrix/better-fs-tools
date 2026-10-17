import type { StateNeedsDigest, ToolCallContext, ToolDefinition } from "@better-fs-tools/read";

import type { ApplyPatchToolOptions, EditToolOptions, WriteToolOptions } from "../contract/deps.ts";
import type { ApplyPatchInput, EditInput, WriteInput } from "../contract/input.ts";
import type { WriteLimits } from "../contract/limits.ts";
import type { WriteCanonicalParam } from "../contract/messages.ts";
import type { MutationResult } from "../contract/result.ts";
import { createApplyPatchTool, createEditTool, createWriteTool } from "../core/create-tools.ts";
import { parseApplyPatchInput, parseEditInput, parseWriteInput } from "../core/input.ts";
import { resolveWriteLimits } from "../core/limits.ts";
import type {
  EditSignature,
  MutationSignature,
  PatchSignature,
  WriteSignature,
} from "./contract.ts";
import { defaultEditSignature } from "./edit.ts";
import { writeSignatureMessages } from "./messages.ts";
import { defaultPatchSignature } from "./patch.ts";
import { defaultWriteSignature } from "./write.ts";

/** An edit, write, or apply_patch tool bound to its signature. */
export interface MutationToolDefinition<TInput, THost = undefined> extends ToolDefinition<
  TInput,
  MutationResult,
  THost,
  WriteCanonicalParam
> {
  readonly signature: MutationSignature<TInput>;
}

export type EditToolDefinition<THost = undefined> = MutationToolDefinition<EditInput, THost>;
export type WriteToolDefinition<THost = undefined> = MutationToolDefinition<WriteInput, THost>;
export type ApplyPatchToolDefinition<THost = undefined> = MutationToolDefinition<
  ApplyPatchInput,
  THost
>;

/** The edit tool's options, plus the signature the model sees. */
export type EditToolDefinitionOptions<THost = undefined> = EditToolOptions<THost> &
  StateNeedsDigest & {
    /** Default defaultEditSignature({ matchers }), so the description names the matchers. */
    readonly signature?: EditSignature;
  };

/** The write tool's options, plus the signature the model sees. */
export type WriteToolDefinitionOptions<THost = undefined> = WriteToolOptions<THost> &
  StateNeedsDigest & {
    /** Default defaultWriteSignature(). */
    readonly signature?: WriteSignature;
  };

/** The apply_patch tool's options, plus the signature the model sees. */
export type ApplyPatchToolDefinitionOptions<THost = undefined> = ApplyPatchToolOptions<THost> &
  StateNeedsDigest & {
    /** Default defaultPatchSignature(). */
    readonly signature?: PatchSignature;
  };

/**
 * Creates the edit tool and binds it to a signature. The signature's `param`
 * message goes under `options.messages`, so a host message still wins. Throws
 * TypeError where createEditTool() does.
 */
export function editToolDefinition<THost = undefined>(
  options: EditToolDefinitionOptions<THost>,
): EditToolDefinition<THost> {
  checkOptions(options, "editToolDefinition");
  const { signature: given, ...rest } = options;
  const signature =
    given ?? defaultEditSignature(rest.matchers === undefined ? {} : { matchers: rest.matchers });
  const edit = createEditTool<THost>({
    ...rest,
    messages: { ...writeSignatureMessages(signature), ...rest.messages },
  } as EditToolOptions<THost> & StateNeedsDigest);
  return bindMutationTool(signature, edit as Core<EditInput, THost>, parseEditInput, rest.limits);
}

/** Creates the write tool and binds it to a signature, as editToolDefinition(). */
export function writeToolDefinition<THost = undefined>(
  options: WriteToolDefinitionOptions<THost>,
): WriteToolDefinition<THost> {
  checkOptions(options, "writeToolDefinition");
  const { signature = defaultWriteSignature(), ...rest } = options;
  const write = createWriteTool<THost>({
    ...rest,
    messages: { ...writeSignatureMessages(signature), ...rest.messages },
  } as WriteToolOptions<THost> & StateNeedsDigest);
  return bindMutationTool(
    signature,
    write as Core<WriteInput, THost>,
    parseWriteInput,
    rest.limits,
  );
}

/**
 * Creates the apply_patch tool and binds it to a signature, as
 * editToolDefinition(). A grammar on the signature is copied to the definition.
 */
export function applyPatchToolDefinition<THost = undefined>(
  options: ApplyPatchToolDefinitionOptions<THost>,
): ApplyPatchToolDefinition<THost> {
  checkOptions(options, "applyPatchToolDefinition");
  const { signature = defaultPatchSignature(), ...rest } = options;
  const applyPatch = createApplyPatchTool<THost>({
    ...rest,
    messages: { ...writeSignatureMessages(signature), ...rest.messages },
  } as ApplyPatchToolOptions<THost> & StateNeedsDigest);
  return bindMutationTool(
    signature,
    applyPatch as Core<ApplyPatchInput, THost>,
    parseApplyPatchInput,
    rest.limits,
  );
}

type Core<TInput, THost> = (input: TInput, ctx: ToolCallContext<THost>) => Promise<MutationResult>;

function bindMutationTool<TInput, THost>(
  signature: MutationSignature<TInput>,
  tool: Core<TInput, THost>,
  parse: (input: TInput, limits: Readonly<WriteLimits>) => unknown,
  limitOverrides: Partial<WriteLimits> | undefined,
): MutationToolDefinition<TInput, THost> {
  const limits = resolveWriteLimits(limitOverrides);
  return Object.freeze<MutationToolDefinition<TInput, THost>>({
    name: signature.name,
    description: signature.description,
    inputSchema: signature.schema,
    ...(signature.grammar === undefined ? {} : { grammar: signature.grammar }),
    signature,
    validate(modelInput) {
      const input = signature.toInput(modelInput);
      parse(input, limits);
      return input;
    },
    execute: async (modelInput, ctx) => tool(signature.toInput(modelInput), ctx),
  });
}

function checkOptions(options: unknown, label: string): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${label} options must be an object`);
  }
}
