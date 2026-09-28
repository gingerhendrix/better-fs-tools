import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import { nodeDigest } from "@better-fs-tools/node";
import { createReadTool, lineNumberFormatter, resolveReadLimits } from "@better-fs-tools/read";
import type {
  ReadFormatContext,
  ReadFormatter,
  JsonObject,
  ReadContext,
  ReadResult,
  ReadToolDeps,
  StateNeedsDigest,
} from "@better-fs-tools/read";
import { defaultReadSignature, readSignatureMessages } from "@better-fs-tools/read/signature";
import type { ReadSignature } from "@better-fs-tools/read/signature";

import { toPiReadDetails } from "./details.ts";
import type { PiReadDetails } from "./details.ts";
import { toPiPart } from "./parts.ts";
import type { PiContentPart } from "./parts.ts";
import { checkPiContext, checkPiOptions, piFileSystems } from "./roots.ts";
import type { PiFileSystems } from "./roots.ts";

export type { PiContentPart } from "./parts.ts";

/** Pi 0.84.2's own read snippet and guideline, so the system prompt is unchanged. */
const PROMPT_SNIPPET = "Read file contents";
const PROMPT_GUIDELINES: readonly string[] = ["Use read to examine files instead of cat or sed."];

export interface CreatePiReadToolOptions extends Omit<ReadToolDeps<ExtensionContext>, "fs"> {
  /** Default defaultReadSignature({ name: "read" }). */
  readonly signature?: ReadSignature;
  /** Default "Read file contents". */
  readonly promptSnippet?: string;
  /** Default ["Use read to examine files instead of cat or sed."]. */
  readonly promptGuidelines?: readonly string[];
  /** Added to /dev, /proc, /sys. */
  readonly denyRoots?: readonly string[];
  readonly symlinks?: "follow-within-roots" | "reject";
}

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
  const { denyRoots, symlinks, ...rest } = options;
  return buildPiReadTool(rest, piFileSystems({ denyRoots, symlinks }));
}

/** createPiReadTool over a given fs factory, so createPiFsTools can share one root cache. */
export function buildPiReadTool(
  options: Omit<CreatePiReadToolOptions, "denyRoots" | "symlinks">,
  fileSystemFor: PiFileSystems,
): PiReadTool {
  const {
    signature = defaultReadSignature({ name: "read" }),
    promptSnippet = PROMPT_SNIPPET,
    promptGuidelines = PROMPT_GUIDELINES,
    ...deps
  } = options;
  const limits = resolveReadLimits(deps.limits);
  const formatter: ReadFormatter<ExtensionContext> = deps.formatter ?? lineNumberFormatter();
  const digest = deps.digest === undefined ? nodeDigest() : deps.digest;
  // The core checks at run time that a state comes with a digest.
  const read = createReadTool<ExtensionContext>({
    ...deps,
    limits,
    messages: { ...readSignatureMessages(signature), ...deps.messages },
    formatter,
    digest,
    fs: fileSystemFor,
  } as ReadToolDeps<ExtensionContext> & StateNeedsDigest);

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
      const result = await read(signature.toRead(input), call);
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
