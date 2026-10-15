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
import { signatureSnippet } from "./prompt.ts";
import { canonicalArgs, setRenderArgs } from "./renderers.ts";
import { PI_READ_ANNOTATIONS } from "./results.ts";
import type { PiToolAnnotations } from "./results.ts";
import { checkPiContext, checkPiOptions, piFileSystems } from "./roots.ts";

export type { PiContentPart } from "./parts.ts";

/** Pi prompt options of the read tool. */
export interface PiReadOptions {
  /** Default defaultReadSignature(), as in every integration. */
  readonly signature?: ReadSignature;
  /** Default the first sentence of the signature description. Pi lists the tool with it. */
  readonly promptSnippet?: string;
  /** Default []. */
  readonly promptGuidelines?: readonly string[];
}

/**
 * Options for createPiReadTool. digest defaults to nodeDigest(); a state needs
 * a digest that is not null. converters defaults to [imageConverter()], as in
 * the AI SDK integration. A list you pass replaces it: [] turns images off.
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
  const signature = options.signature ?? defaultReadSignature();
  return {
    signature,
    promptSnippet: options.promptSnippet ?? signatureSnippet(signature.description),
    promptGuidelines: options.promptGuidelines ?? [],
    limits: resolveReadLimits(options.limits),
    formatter: options.formatter ?? lineNumberFormatter(),
    messages: { ...readSignatureMessages(signature), ...options.messages },
    // Images are on in Pi and the AI SDK. Open decision: the same in every integration.
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
  const tool = Object.freeze<PiReadTool>({
    name: signature.name,
    label: signature.name,
    description: signature.description,
    promptSnippet,
    promptGuidelines: [...promptGuidelines],
    parameters: Type.Unsafe(signature.schema),
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
      return { content, details, isError: result.status === "error" };
    },
  });
  setRenderArgs(tool, (args) => signature.toInput(args), canonicalArgs);
  return tool;
}
