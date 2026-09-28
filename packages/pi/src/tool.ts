import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import { nodeDigest } from "@better-fs-tools/node";
import type { NodeFileSystemOptions } from "@better-fs-tools/node";
import { createReadTool, lineNumberFormatter, resolveReadLimits } from "@better-fs-tools/read";
import type {
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

/** Pi 0.84.2's own read snippet and guideline, so the system prompt is unchanged. */
const PROMPT_SNIPPET = "Read file contents";
const PROMPT_GUIDELINES: readonly string[] = ["Use read to examine files instead of cat or sed."];

/** The Pi options of the read tool, which createPiFsTools takes under `read` too. */
export interface PiReadOptions {
  /** Default defaultReadSignature({ name: "read" }). */
  readonly signature?: ReadSignature;
  /** Default "Read file contents". */
  readonly promptSnippet?: string;
  /** Default ["Use read to examine files instead of cat or sed."]. */
  readonly promptGuidelines?: readonly string[];
}

/**
 * Every read option except fs, and the Pi options. digest defaults to
 * nodeDigest(); a state needs a digest that is not null.
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
  /** Type.Unsafe(signature.schema). */
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
 * Throws TypeError when options contain fs, cwd, or allowedRoots (D5).
 * Builds one core tool. Its fs is a factory over ctx.cwd with an 8-root cache (D19).
 * Stateless by default: no store, no session id, nothing written outside the process.
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

/** A read tool's Pi options with their defaults, and the core options that the Pi face needs too. */
export interface PiReadParts {
  readonly signature: ReadSignature;
  readonly promptSnippet: string;
  readonly promptGuidelines: readonly string[];
  readonly limits: Readonly<ReadLimits>;
  readonly formatter: ReadFormatter<ExtensionContext>;
  /** The signature's messages under the host's. */
  readonly messages: Partial<ReadMessageCatalog>;
}

/**
 * The Pi defaults: the signature, the prompt text, lineNumberFormatter(), the
 * resolved limits, and the signature's messages under the host's.
 */
export function piReadParts(
  options: PiReadOptions &
    Pick<Partial<ReadToolDeps<ExtensionContext>>, "limits" | "messages" | "formatter">,
): PiReadParts {
  const signature = options.signature ?? defaultReadSignature({ name: "read" });
  return {
    signature,
    promptSnippet: options.promptSnippet ?? PROMPT_SNIPPET,
    promptGuidelines: options.promptGuidelines ?? PROMPT_GUIDELINES,
    limits: resolveReadLimits(options.limits),
    formatter: options.formatter ?? lineNumberFormatter(),
    messages: { ...readSignatureMessages(signature), ...options.messages },
  };
}

/** The core options that piReadParts fills in, to spread over the host's. */
export function piReadDeps(parts: PiReadParts) {
  return { limits: parts.limits, formatter: parts.formatter, messages: parts.messages };
}

/** The Pi face of a built read tool. `digest` is the core's, for the "view" format context. */
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
      // Pi's ctx itself is the host: no copy, no spread, no freeze.
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

/**
 * The body in "view" mode, with the same call object. null for parts, a
 * non-ok result, or a formatter that throws: the core already fell back and
 * noted it in "model" mode.
 */
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
    return null;
  }
}
