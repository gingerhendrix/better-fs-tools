import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import { nodeDigest } from "@better-fs-tools/node";
import type { JsonObject, StateNeedsDigest, ToolCallContext } from "@better-fs-tools/read";
import { createApplyPatchTool, createEditTool, createWriteTool } from "@better-fs-tools/write";
import type {
  ApplyPatchToolDeps,
  EditToolDeps,
  MutationResult,
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
import { checkPiContext, checkPiOptions, piFileSystems, splitPiRootOptions } from "./roots.ts";
import type { PiFileSystems, PiRootOptions } from "./roots.ts";

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

interface PiMutationOptions extends PiRootOptions {
  readonly promptSnippet?: string;
  readonly promptGuidelines?: readonly string[];
}

export interface CreatePiEditToolOptions
  extends Omit<EditToolDeps<ExtensionContext>, "fs">, PiMutationOptions {
  /** Default multiEditSignature({ matchers }): Pi's own shape, so Pi's edit renderer and prompt fit (D17). */
  readonly signature?: EditSignature;
}

export interface CreatePiWriteToolOptions
  extends Omit<WriteToolDeps<ExtensionContext>, "fs">, PiMutationOptions {
  /** Default defaultWriteSignature(). */
  readonly signature?: WriteSignature;
}

export interface CreatePiApplyPatchToolOptions
  extends Omit<ApplyPatchToolDeps<ExtensionContext>, "fs">, PiMutationOptions {
  /** Default freeformPatchSignature() (D18). */
  readonly signature?: PatchSignature;
}

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

/**
 * Throws TypeError on fs, cwd, or allowedRoots in options. fs is a factory
 * over ctx.cwd with the 8-root cache. state stays null unless given: use
 * createPiFsTools() for a store shared with read.
 */
export function createPiEditTool(options: CreatePiEditToolOptions = {}): PiMutationTool {
  checkPiOptions(options, "edit");
  const [roots, rest] = splitPiRootOptions(options);
  return buildPiEditTool(rest, piFileSystems(roots));
}

/** As createPiEditTool. `details` is always undefined, as for Pi's own write. */
export function createPiWriteTool(options: CreatePiWriteToolOptions = {}): PiMutationTool {
  checkPiOptions(options, "write");
  const [roots, rest] = splitPiRootOptions(options);
  return buildPiWriteTool(rest, piFileSystems(roots));
}

/** As createPiEditTool. A grammar signature sets constrainedSampling. */
export function createPiApplyPatchTool(
  options: CreatePiApplyPatchToolOptions = {},
): PiMutationTool {
  checkPiOptions(options, "apply_patch");
  const [roots, rest] = splitPiRootOptions(options);
  return buildPiApplyPatchTool(rest, piFileSystems(roots));
}

/** createPiEditTool over a given fs factory, so createPiFsTools can share one root cache. */
export function buildPiEditTool(
  options: Omit<CreatePiEditToolOptions, keyof PiRootOptions>,
  fileSystemFor: PiFileSystems,
): PiMutationTool {
  const {
    signature = multiEditSignature(
      options.matchers === undefined ? {} : { matchers: options.matchers },
    ),
    promptSnippet = EDIT_SNIPPET,
    promptGuidelines = EDIT_GUIDELINES,
    ...deps
  } = options;
  const edit = createEditTool<ExtensionContext>(withDefaults(deps, signature, fileSystemFor));
  return adapt(signature, edit, "edit", promptSnippet, promptGuidelines, true);
}

/** createPiWriteTool over a given fs factory. */
export function buildPiWriteTool(
  options: Omit<CreatePiWriteToolOptions, keyof PiRootOptions>,
  fileSystemFor: PiFileSystems,
): PiMutationTool {
  const {
    signature = defaultWriteSignature(),
    promptSnippet = WRITE_SNIPPET,
    promptGuidelines = WRITE_GUIDELINES,
    ...deps
  } = options;
  const write = createWriteTool<ExtensionContext>(withDefaults(deps, signature, fileSystemFor));
  return adapt(signature, write, "write", promptSnippet, promptGuidelines, false);
}

/** createPiApplyPatchTool over a given fs factory. */
export function buildPiApplyPatchTool(
  options: Omit<CreatePiApplyPatchToolOptions, keyof PiRootOptions>,
  fileSystemFor: PiFileSystems,
): PiMutationTool {
  const {
    signature = freeformPatchSignature(),
    promptSnippet = PATCH_SNIPPET,
    promptGuidelines = PATCH_GUIDELINES,
    ...deps
  } = options;
  const applyPatch = createApplyPatchTool<ExtensionContext>(
    withDefaults(deps, signature, fileSystemFor),
  );
  return adapt(signature, applyPatch, "apply_patch", promptSnippet, promptGuidelines, true);
}

/** fs over ctx.cwd, digest nodeDigest() unless given, and the signature's messages under the host's. */
function withDefaults<D extends { readonly messages?: object; readonly digest?: unknown }>(
  deps: D,
  signature: MutationSignature<unknown>,
  fileSystemFor: PiFileSystems,
) {
  return {
    ...deps,
    fs: fileSystemFor,
    digest: deps.digest === undefined ? nodeDigest() : deps.digest,
    messages: { ...writeSignatureMessages(signature), ...deps.messages },
    // The core checks at run time that a state comes with a digest.
  } as D & { fs: PiFileSystems } & StateNeedsDigest;
}

function adapt(
  signature: MutationSignature<unknown>,
  tool: Core,
  toolName: string,
  promptSnippet: string,
  promptGuidelines: readonly string[],
  withDetails: boolean,
): PiMutationTool {
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
