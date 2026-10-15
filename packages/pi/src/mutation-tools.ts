import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import { nodeDigest } from "@better-fs-tools/node";
import type { JsonObject, StateNeedsDigestOrDefault, ToolCallContext } from "@better-fs-tools/read";
import { createApplyPatchTool, createEditTool, createWriteTool } from "@better-fs-tools/write";
import type {
  ApplyPatchToolDeps,
  EditToolDeps,
  MutationResult,
  WriteMessageCatalog,
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

import { toPiMutationDetails } from "./mutation-details.ts";
import type { PiMutationDetails } from "./mutation-details.ts";
import { toPiPart } from "./parts.ts";
import type { PiContentPart } from "./parts.ts";
import { signatureSnippet } from "./prompt.ts";
import { canonicalArgs, piEditArgs, setRenderArgs } from "./renderers.ts";
import { PI_PATCH_ANNOTATIONS, PI_WRITE_ANNOTATIONS } from "./results.ts";
import type { PiToolAnnotations } from "./results.ts";
import { piMutationQueueLocks } from "./locks.ts";
import { checkPiContext, checkPiOptions, piFileSystems } from "./roots.ts";
import type { PiRootOptions } from "./roots.ts";

/** Pi prompt options of the edit, write, and apply_patch tools. */
export interface PiMutationOptions<TSignature> {
  readonly signature?: TSignature;
  /** Default the first sentence of the signature description. Pi lists the tool with it. */
  readonly promptSnippet?: string;
  /** Default []. */
  readonly promptGuidelines?: readonly string[];
}

/**
 * Options for createPiEditTool. The default signature is
 * defaultEditSignature({ matchers }), as in every integration. digest defaults
 * to nodeDigest(); a state needs a digest that is not null.
 */
export type CreatePiEditToolOptions = Omit<EditToolDeps<ExtensionContext>, "fs"> &
  StateNeedsDigestOrDefault &
  PiRootOptions &
  PiMutationOptions<EditSignature>;

/** As CreatePiEditToolOptions, for write. The default signature is defaultWriteSignature(). */
export type CreatePiWriteToolOptions = Omit<WriteToolDeps<ExtensionContext>, "fs"> &
  StateNeedsDigestOrDefault &
  PiRootOptions &
  PiMutationOptions<WriteSignature>;

/** As CreatePiEditToolOptions, for apply_patch. The default signature is defaultPatchSignature(). */
export type CreatePiApplyPatchToolOptions = Omit<ApplyPatchToolDeps<ExtensionContext>, "fs"> &
  StateNeedsDigestOrDefault &
  PiRootOptions &
  PiMutationOptions<PatchSignature>;

export interface PiMutationToolResult {
  content: PiContentPart[];
  details: PiMutationDetails | undefined;
  /** true when the change failed (status "error"). Pi then shows the content as an error. */
  isError: boolean;
}

/** Assignable to ToolDefinition<TSchema, PiMutationDetails | undefined> from Pi 1.x. */
export interface PiMutationTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly promptGuidelines: string[];
  /** The JSON Schema of the tool input. */
  readonly parameters: TSchema;
  /** Set when the signature has a grammar. */
  readonly constrainedSampling?: { type: "grammar"; variants: { openai_lark: string } };
  /** destructiveHint: true. idempotentHint is true for write only. */
  readonly annotations: PiToolAnnotations;
  execute(
    toolCallId: string,
    input: JsonObject,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<PiMutationToolResult>;
}

type Core = (input: never, ctx: ToolCallContext<ExtensionContext>) => Promise<MutationResult>;

export interface PiMutationParts {
  readonly tool: "edit" | "write" | "apply_patch";
  readonly signature: MutationSignature<unknown>;
  readonly promptSnippet: string;
  readonly promptGuidelines: readonly string[];
  readonly messages: Partial<WriteMessageCatalog>;
}

type PartsInput<TSignature> = PiMutationOptions<TSignature> & {
  readonly messages?: Partial<WriteMessageCatalog>;
};

export function piEditParts(
  options: PartsInput<EditSignature> & Pick<Partial<EditToolDeps>, "matchers">,
): PiMutationParts {
  const signature =
    options.signature ??
    defaultEditSignature(options.matchers === undefined ? {} : { matchers: options.matchers });
  return parts("edit", signature, options);
}

export function piWriteParts(options: PartsInput<WriteSignature>): PiMutationParts {
  const signature = options.signature ?? defaultWriteSignature();
  return parts("write", signature, options);
}

export function piApplyPatchParts(options: PartsInput<PatchSignature>): PiMutationParts {
  const signature = options.signature ?? defaultPatchSignature();
  return parts("apply_patch", signature, options);
}

function parts(
  tool: PiMutationParts["tool"],
  signature: MutationSignature<unknown>,
  options: PartsInput<unknown>,
): PiMutationParts {
  return {
    tool,
    signature,
    promptSnippet: options.promptSnippet ?? signatureSnippet(signature.description),
    promptGuidelines: options.promptGuidelines ?? [],
    messages: { ...writeSignatureMessages(signature), ...options.messages },
  };
}

/**
 * Creates a Pi edit tool rooted at each call's ctx.cwd. Throws TypeError when
 * options set fs, cwd, or allowedRoots. Read-before-write is off unless you
 * pass a `state`; use createPiFsTools({ state }) for a store shared with read.
 */
export function createPiEditTool(options: CreatePiEditToolOptions = {}): PiMutationTool {
  checkPiOptions(options, "edit");
  const {
    denyRoots,
    symlinks,
    hardLinks,
    newFileMode,
    newDirectoryMode,
    signature: _signature,
    promptSnippet: _snippet,
    promptGuidelines: _lines,
    ...deps
  } = options;
  const fs = piFileSystems({ denyRoots, symlinks, hardLinks, newFileMode, newDirectoryMode });
  const made = piEditParts(options);
  const { messages } = made;
  const locks = deps.locks ?? piMutationQueueLocks();
  // digest: null narrows the options to the branch without a state.
  if (deps.digest === null) {
    return adaptPiMutationTool(
      made,
      createEditTool({ ...deps, fs, locks, messages, digest: null }),
    );
  }
  const digest = deps.digest ?? nodeDigest();
  return adaptPiMutationTool(made, createEditTool({ ...deps, fs, locks, messages, digest }));
}

/** Creates a Pi write tool, as createPiEditTool. `details` is always undefined, as for Pi's own write. */
export function createPiWriteTool(options: CreatePiWriteToolOptions = {}): PiMutationTool {
  checkPiOptions(options, "write");
  const {
    denyRoots,
    symlinks,
    hardLinks,
    newFileMode,
    newDirectoryMode,
    signature: _signature,
    promptSnippet: _snippet,
    promptGuidelines: _lines,
    ...deps
  } = options;
  const fs = piFileSystems({ denyRoots, symlinks, hardLinks, newFileMode, newDirectoryMode });
  const made = piWriteParts(options);
  const { messages } = made;
  const locks = deps.locks ?? piMutationQueueLocks();
  if (deps.digest === null) {
    return adaptPiMutationTool(
      made,
      createWriteTool({ ...deps, fs, locks, messages, digest: null }),
    );
  }
  const digest = deps.digest ?? nodeDigest();
  return adaptPiMutationTool(made, createWriteTool({ ...deps, fs, locks, messages, digest }));
}

/** Creates a Pi apply_patch tool, as createPiEditTool. A grammar signature sets constrainedSampling. */
export function createPiApplyPatchTool(
  options: CreatePiApplyPatchToolOptions = {},
): PiMutationTool {
  checkPiOptions(options, "apply_patch");
  const {
    denyRoots,
    symlinks,
    hardLinks,
    newFileMode,
    newDirectoryMode,
    signature: _signature,
    promptSnippet: _snippet,
    promptGuidelines: _lines,
    ...deps
  } = options;
  const fs = piFileSystems({ denyRoots, symlinks, hardLinks, newFileMode, newDirectoryMode });
  const made = piApplyPatchParts(options);
  const { messages } = made;
  const locks = deps.locks ?? piMutationQueueLocks();
  if (deps.digest === null) {
    return adaptPiMutationTool(
      made,
      createApplyPatchTool({ ...deps, fs, locks, messages, digest: null }),
    );
  }
  const digest = deps.digest ?? nodeDigest();
  return adaptPiMutationTool(made, createApplyPatchTool({ ...deps, fs, locks, messages, digest }));
}

export function adaptPiMutationTool(made: PiMutationParts, tool: Core): PiMutationTool {
  const { signature, tool: toolName, promptSnippet, promptGuidelines } = made;
  const withDetails = toolName !== "write";
  const grammar = signature.grammar;
  const adapted = Object.freeze<PiMutationTool>({
    name: signature.name,
    label: signature.name,
    description: signature.description,
    promptSnippet,
    promptGuidelines: [...promptGuidelines],
    parameters: Type.Unsafe(signature.schema),
    annotations: { ...(toolName === "write" ? PI_WRITE_ANNOTATIONS : PI_PATCH_ANNOTATIONS) },
    ...(grammar === undefined
      ? {}
      : {
          constrainedSampling: { type: "grammar", variants: { openai_lark: grammar.lark } },
        }),
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      checkPiContext(ctx, toolName);
      const call: ToolCallContext<ExtensionContext> = {
        ...(signal === undefined ? {} : { signal }),
        callId: toolCallId,
        host: ctx,
      };
      const result = await tool(signature.toInput(input) as never, call);
      return {
        content: result.content.map((part) => toPiPart(part, toolName)),
        details: withDetails ? toPiMutationDetails(result) : undefined,
        isError: result.status === "error",
      };
    },
  });
  // Pi has built-in renderers for edit and write. apply_patch has none.
  if (toolName !== "apply_patch") {
    const toPi = toolName === "edit" ? piEditArgs : canonicalArgs;
    setRenderArgs(adapted, (args) => signature.toInput(args), toPi);
  }
  return adapted;
}
