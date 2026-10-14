import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import { nodeDigest } from "@better-fs-tools/node";
import type { NodeFileSystemOptions } from "@better-fs-tools/node";
import {
  createReadTool,
  imageConverter,
  lineNumberFormatter,
  resolveReadLimits,
} from "@better-fs-tools/read";
import type {
  Converter,
  Digest,
  JsonObject,
  ReadContext,
  ReadFormatter,
  ReadLimits,
  ReadMessageCatalog,
  ReadTool,
  ReadToolDeps,
  StateNeedsDigestOrDefault,
} from "@better-fs-tools/read";
import { defaultReadSignature, readSignatureMessages } from "@better-fs-tools/read/signature";
import type { ReadSignature } from "@better-fs-tools/read/signature";

import { toPiReadDetails, viewOf } from "./details.ts";
import type { PiReadDetails } from "./details.ts";
import { toPiPart } from "./parts.ts";
import type { PiContentPart } from "./parts.ts";
import { PI_READ_ANNOTATIONS, PI_READ_OUTPUT_SCHEMA, toPiReadOutput } from "./results.ts";
import type { PiReadOutput, PiToolAnnotations } from "./results.ts";
import { checkPiContext, checkPiOptions, piFileSystems } from "./roots.ts";

export type { PiContentPart } from "./parts.ts";

const PI_BUILTIN_READ_SNIPPET = "Read file contents";
const PI_BUILTIN_READ_GUIDELINES: readonly string[] = [
  "Use read to examine files instead of cat or sed.",
];

/** Pi prompt options of the read tool. */
export interface PiReadOptions {
  /** Default defaultReadSignature({ name: "read" }). */
  readonly signature?: ReadSignature;
  /** Default "Read file contents". */
  readonly promptSnippet?: string;
  /** Default ["Use read to examine files instead of cat or sed."]. */
  readonly promptGuidelines?: readonly string[];
}

/**
 * Options for createPiReadTool. digest defaults to nodeDigest(); a state needs
 * a digest that is not null. converters defaults to [imageConverter()], as
 * Pi's own read shows images. A list you pass replaces it: [] turns images off.
 */
export type CreatePiReadToolOptions = Omit<ReadToolDeps<ExtensionContext>, "fs"> &
  StateNeedsDigestOrDefault &
  PiReadOptions & {
    /** Added to /dev, /proc, /sys. */
    readonly denyRoots?: readonly string[];
    readonly symlinks?: NodeFileSystemOptions["symlinks"];
  };

export interface PiReadToolResult {
  content: PiContentPart[];
  details: PiReadDetails;
  /** Pi's read output for codemode scripts. Absent on an error, so a script gets a rejection. */
  structuredContent?: PiReadOutput;
  /** true when the read failed (status "error"). Pi then shows the content as an error. */
  isError: boolean;
}

/** Assignable to ToolDefinition<TSchema, PiReadDetails> from Pi 1.x. */
export interface PiReadTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly promptGuidelines: string[];
  /** The JSON Schema of the tool input. */
  readonly parameters: TSchema;
  /** Pi's own read output schema: the text, or an image with the text as its note. */
  readonly outputSchema: TSchema;
  /** readOnlyHint: true. */
  readonly annotations: PiToolAnnotations;
  execute(
    toolCallId: string,
    input: JsonObject,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<PiReadToolResult>;
}

/**
 * Creates a Pi read tool rooted at each call's ctx.cwd. Throws TypeError when
 * options set fs, cwd, or allowedRoots. It keeps no read state by default and
 * writes nothing outside the process. An image becomes a Pi image part unless
 * options.converters leaves imageConverter() out.
 */
export function createPiReadTool(options: CreatePiReadToolOptions = {}): PiReadTool {
  checkPiOptions(options, "read");
  const {
    denyRoots,
    symlinks,
    signature: _signature,
    promptSnippet: _promptSnippet,
    promptGuidelines: _promptGuidelines,
    ...deps
  } = options;
  const parts = piReadParts(options);
  const fs = piFileSystems({ denyRoots, symlinks });
  // digest: null narrows the options to the branch without a state.
  if (deps.digest === null) {
    const read = createReadTool({ ...deps, ...piReadDeps(parts), fs, digest: null });
    return adaptPiReadTool(parts, read, null);
  }
  const digest = deps.digest ?? nodeDigest();
  const read = createReadTool({ ...deps, ...piReadDeps(parts), fs, digest });
  return adaptPiReadTool(parts, read, digest);
}

export interface PiReadParts {
  readonly signature: ReadSignature;
  readonly promptSnippet: string;
  readonly promptGuidelines: readonly string[];
  readonly limits: Readonly<ReadLimits>;
  readonly formatter: ReadFormatter<ExtensionContext>;
  readonly messages: Partial<ReadMessageCatalog>;
  readonly converters: readonly Converter<ExtensionContext>[];
}

export function piReadParts(
  options: PiReadOptions &
    Pick<
      Partial<ReadToolDeps<ExtensionContext>>,
      "limits" | "messages" | "formatter" | "converters"
    >,
): PiReadParts {
  const signature = options.signature ?? defaultReadSignature({ name: "read" });
  return {
    signature,
    promptSnippet: options.promptSnippet ?? PI_BUILTIN_READ_SNIPPET,
    promptGuidelines: options.promptGuidelines ?? PI_BUILTIN_READ_GUIDELINES,
    limits: resolveReadLimits(options.limits),
    formatter: options.formatter ?? lineNumberFormatter(),
    messages: { ...readSignatureMessages(signature), ...options.messages },
    // Pi's own read returns images, so the Pi host turns them on.
    converters: options.converters ?? [imageConverter<ExtensionContext>()],
  };
}

export function piReadDeps(parts: PiReadParts) {
  return {
    limits: parts.limits,
    formatter: parts.formatter,
    messages: parts.messages,
    converters: parts.converters,
  };
}

export function adaptPiReadTool(
  parts: PiReadParts,
  read: ReadTool<ExtensionContext>,
  digest: Digest | null,
): PiReadTool {
  const { signature, promptSnippet, promptGuidelines, limits, formatter } = parts;
  return Object.freeze<PiReadTool>({
    name: signature.name,
    label: signature.name,
    description: signature.description,
    promptSnippet,
    promptGuidelines: [...promptGuidelines],
    parameters: Type.Unsafe(signature.schema),
    outputSchema: PI_READ_OUTPUT_SCHEMA,
    annotations: { ...PI_READ_ANNOTATIONS },
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      checkPiContext(ctx, "read");
      const call: ReadContext<ExtensionContext> = {
        ...(signal === undefined ? {} : { signal }),
        callId: toolCallId,
        host: ctx,
      };
      const result = await read(signature.toInput(input), call);
      const content = result.content.map((part) => toPiPart(part, "read"));
      const details = toPiReadDetails(
        result,
        viewOf(formatter, result, { digest, limits, mode: "view", call }),
        limits.maxViewBytes,
      );
      if (result.status === "error") return { content, details, isError: true };
      return { content, details, structuredContent: toPiReadOutput(content), isError: false };
    },
  });
}
