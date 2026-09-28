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
  defaultWriteSignature,
  freeformPatchSignature,
  multiEditSignature,
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
import { checkPiContext, checkPiOptions, piFileSystems } from "./roots.ts";
import type { PiRootOptions } from "./roots.ts";

/** Pi 0.84.4's editToolSystemPromptContribution, so the system prompt is unchanged. */
const EDIT_SNIPPET =
  "Make precise file edits with exact text replacement, including multiple disjoint edits in one call";
const EDIT_GUIDELINES: readonly string[] = [
  "Use edit for precise changes (edits[].oldText must match exactly)",
  "When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
  "Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
  "Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
];
/** Pi 0.84.4's writeToolSystemPromptContribution. */
const WRITE_SNIPPET = "Create or overwrite files";
const WRITE_GUIDELINES: readonly string[] = ["Use write only for new files or complete rewrites."];
/** Pi has no apply_patch tool, so these are this package's own. */
const PATCH_SNIPPET = "Add, update, move, or delete files with one patch";
const PATCH_GUIDELINES: readonly string[] = [
  "Use apply_patch for related changes across several files, or to add, move, or delete files.",
];

/** The Pi options of a write tool, which createPiFsTools takes under each tool too. */
export interface PiMutationOptions<TSignature> {
  readonly signature?: TSignature;
  readonly promptSnippet?: string;
  readonly promptGuidelines?: readonly string[];
}

/**
 * Every edit option except fs, the root options, and the Pi options. The
 * default signature is multiEditSignature({ matchers }): Pi's own shape, so
 * Pi's edit renderer and prompt fit (D17). digest defaults to nodeDigest();
 * a state needs a digest that is not null.
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

/** As CreatePiEditToolOptions, for apply_patch. The default signature is freeformPatchSignature() (D18). */
export type CreatePiApplyPatchToolOptions = Omit<ApplyPatchToolDeps<ExtensionContext>, "fs"> &
  StateNeedsDigestOrDefault &
  PiRootOptions &
  PiMutationOptions<PatchSignature>;

export interface PiMutationToolResult {
  content: PiContentPart[];
  details: PiMutationDetails | undefined;
}

/** Assignable to ToolDefinition<TSchema, PiMutationDetails | undefined> from Pi 0.84.2. */
export interface PiMutationTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly promptGuidelines: string[];
  /** Type.Unsafe(signature.schema). */
  readonly parameters: TSchema;
  /** Set when the signature has a grammar: { type: "grammar", variants: { openai_lark } }. */
  readonly constrainedSampling?: { type: "grammar"; variants: { openai_lark: string } };
  execute(
    toolCallId: string,
    input: JsonObject,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<PiMutationToolResult>;
}

type Core = (input: never, ctx: ToolCallContext<ExtensionContext>) => Promise<MutationResult>;

/** A write tool's Pi options with their defaults, and the signature's messages under the host's. */
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

/** The Pi defaults of the edit tool. */
export function piEditParts(
  options: PartsInput<EditSignature> & Pick<Partial<EditToolDeps>, "matchers">,
): PiMutationParts {
  const signature =
    options.signature ??
    multiEditSignature(options.matchers === undefined ? {} : { matchers: options.matchers });
  return parts("edit", signature, options, EDIT_SNIPPET, EDIT_GUIDELINES);
}

/** The Pi defaults of the write tool. */
export function piWriteParts(options: PartsInput<WriteSignature>): PiMutationParts {
  const signature = options.signature ?? defaultWriteSignature();
  return parts("write", signature, options, WRITE_SNIPPET, WRITE_GUIDELINES);
}

/** The Pi defaults of the apply_patch tool. */
export function piApplyPatchParts(options: PartsInput<PatchSignature>): PiMutationParts {
  const signature = options.signature ?? freeformPatchSignature();
  return parts("apply_patch", signature, options, PATCH_SNIPPET, PATCH_GUIDELINES);
}

function parts(
  tool: PiMutationParts["tool"],
  signature: MutationSignature<unknown>,
  options: PartsInput<unknown>,
  snippet: string,
  guidelines: readonly string[],
): PiMutationParts {
  return {
    tool,
    signature,
    promptSnippet: options.promptSnippet ?? snippet,
    promptGuidelines: options.promptGuidelines ?? guidelines,
    messages: { ...writeSignatureMessages(signature), ...options.messages },
  };
}

/**
 * Throws TypeError on fs, cwd, or allowedRoots in options. fs is a factory
 * over ctx.cwd with the 8-root cache. state stays null unless given: use
 * createPiFsTools() for a store shared with read.
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
  // digest: null narrows the options to the branch without a state.
  if (deps.digest === null) {
    return adaptPiMutationTool(made, createEditTool({ ...deps, fs, messages, digest: null }));
  }
  const digest = deps.digest ?? nodeDigest();
  return adaptPiMutationTool(made, createEditTool({ ...deps, fs, messages, digest }));
}

/** As createPiEditTool. `details` is always undefined, as for Pi's own write. */
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
  if (deps.digest === null) {
    return adaptPiMutationTool(made, createWriteTool({ ...deps, fs, messages, digest: null }));
  }
  const digest = deps.digest ?? nodeDigest();
  return adaptPiMutationTool(made, createWriteTool({ ...deps, fs, messages, digest }));
}

/** As createPiEditTool. A grammar signature sets constrainedSampling. */
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
  if (deps.digest === null) {
    return adaptPiMutationTool(made, createApplyPatchTool({ ...deps, fs, messages, digest: null }));
  }
  const digest = deps.digest ?? nodeDigest();
  return adaptPiMutationTool(made, createApplyPatchTool({ ...deps, fs, messages, digest }));
}

/** The Pi face of a built write tool. edit and apply_patch have details; write has none. */
export function adaptPiMutationTool(made: PiMutationParts, tool: Core): PiMutationTool {
  const { signature, tool: toolName, promptSnippet, promptGuidelines } = made;
  const withDetails = toolName !== "write";
  const grammar = signature.grammar;
  return Object.freeze<PiMutationTool>({
    name: signature.name,
    label: signature.name,
    description: signature.description,
    promptSnippet,
    promptGuidelines: [...promptGuidelines],
    parameters: Type.Unsafe(signature.schema),
    ...(grammar === undefined
      ? {}
      : {
          constrainedSampling: { type: "grammar", variants: { openai_lark: grammar.lark } },
        }),
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      checkPiContext(ctx, toolName);
      // Pi's ctx itself is the host: no copy, no spread, no freeze.
      const call: ToolCallContext<ExtensionContext> = {
        ...(signal === undefined ? {} : { signal }),
        callId: toolCallId,
        host: ctx,
      };
      // A tool error is a result, not a throw, as for the read adapter.
      const result = await tool(signature.toInput(input) as never, call);
      return {
        content: result.content.map((part) => toPiPart(part, toolName)),
        details: withDetails ? toPiMutationDetails(result) : undefined,
      };
    },
  });
}
