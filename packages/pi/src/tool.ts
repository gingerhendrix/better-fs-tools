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
  ReadFormatContext,
  ReadFormatter,
  ReadLimits,
  ReadMessageCatalog,
  ReadResult,
  ReadTool,
  ReadToolDeps,
  StateNeedsDigestOrDefault,
} from "@better-fs-tools/read";
import { defaultReadSignature, readSignatureMessages } from "@better-fs-tools/read/signature";
import type { ReadSignature } from "@better-fs-tools/read/signature";

import { toPiReadDetails } from "./details.ts";
import type { PiReadDetails } from "./details.ts";
import { toPiPart } from "./parts.ts";
import type { PiContentPart } from "./parts.ts";
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
}

/** Assignable to ToolDefinition<TSchema, PiReadDetails> from Pi 0.84.2. */
export interface PiReadTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly promptGuidelines: string[];
  /** The JSON Schema of the tool input. */
  readonly parameters: TSchema;
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
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      checkPiContext(ctx, "read");
      const call: ReadContext<ExtensionContext> = {
        ...(signal === undefined ? {} : { signal }),
        callId: toolCallId,
        host: ctx,
      };
      const result = await read(signature.toInput(input), call);
      return {
        content: result.content.map((part) => toPiPart(part, "read")),
        details: toPiReadDetails(
          result,
          viewOf(formatter, result, { digest, limits, mode: "view", call }),
          limits.maxViewBytes,
        ),
      };
    },
  });
}

function viewOf(
  formatter: ReadFormatter<ExtensionContext>,
  result: ReadResult,
  ctx: ReadFormatContext<ExtensionContext>,
): string | null {
  if (result.status !== "ok") return null;
  const { content: _content, ...outcome } = result;
  try {
    const view = formatter.format(outcome, ctx);
    return typeof view === "string" ? view : null;
  } catch {
    // The core already fell back and reported the error in "model" mode.
    return null;
  }
}
