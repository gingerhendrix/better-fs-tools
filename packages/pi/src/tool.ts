import { Buffer } from "node:buffer";
import path from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import { nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { createReadTool, lineNumberFormatter, resolveLimits } from "@better-fs-tools/read";
import type {
  ContentPart,
  FormatContext,
  Formatter,
  JsonObject,
  ReadContext,
  ReadResult,
  ReadToolDeps,
} from "@better-fs-tools/read";
import { defaultSignature, signatureMessages } from "@better-fs-tools/read/signature";
import type { ReadSignature } from "@better-fs-tools/read/signature";

import { toPiReadDetails } from "./details.ts";
import type { PiReadDetails } from "./details.ts";

/** Pi 0.84.2's own read snippet and guideline, so the system prompt is unchanged. */
const PROMPT_SNIPPET = "Read file contents";
const PROMPT_GUIDELINES: readonly string[] = ["Use read to examine files instead of cat or sed."];

/** The filesystem type, without a dependency on @better-fs-tools/fs. */
type FileSystem = ReturnType<typeof nodeFileSystem>;

/** Distinct working directories whose filesystems are kept (D19). */
const MAX_CACHED_ROOTS = 8;

/** Options that would widen the root. The root is always the call's ctx.cwd (D5). */
const FORBIDDEN_OPTIONS = ["fs", "cwd", "allowedRoots"] as const;

export interface CreatePiReadToolOptions extends Omit<ReadToolDeps<ExtensionContext>, "fs"> {
  /** Default defaultSignature({ name: "read" }). */
  readonly signature?: ReadSignature;
  /** Default "Read file contents". */
  readonly promptSnippet?: string;
  /** Default ["Use read to examine files instead of cat or sed."]. */
  readonly promptGuidelines?: readonly string[];
  /** Added to /dev, /proc, /sys. */
  readonly denyRoots?: readonly string[];
  readonly symlinks?: "follow-within-roots" | "reject";
}

export type PiContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

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
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Pi read tool options must be an object");
  }
  for (const key of FORBIDDEN_OPTIONS) {
    if (Object.hasOwn(options, key)) {
      throw new TypeError(
        `Pi read tool options cannot set ${key}: the root is bound to ctx.cwd on every call`,
      );
    }
  }

  const {
    signature = defaultSignature({ name: "read" }),
    promptSnippet = PROMPT_SNIPPET,
    promptGuidelines = PROMPT_GUIDELINES,
    denyRoots,
    symlinks,
    ...deps
  } = options;
  const limits = resolveLimits(deps.limits);
  const formatter: Formatter<ExtensionContext> = deps.formatter ?? lineNumberFormatter();
  const digest = deps.digest === undefined ? nodeDigest() : deps.digest;
  const fileSystemFor = rootCache((root) =>
    nodeFileSystem({
      cwd: root,
      allowedRoots: [root],
      ...(denyRoots === undefined ? {} : { denyRoots }),
      ...(symlinks === undefined ? {} : { symlinks }),
    }),
  );
  const read = createReadTool<ExtensionContext>({
    ...deps,
    limits,
    messages: { ...signatureMessages(signature), ...deps.messages },
    formatter,
    digest,
    fs: (call) => fileSystemFor(path.resolve(call.host.cwd)),
  });

  return Object.freeze<PiReadTool>({
    name: signature.name,
    label: signature.name,
    description: signature.description,
    promptSnippet,
    promptGuidelines: [...promptGuidelines],
    parameters: Type.Unsafe(signature.schema),
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      if (
        ctx === null ||
        typeof ctx !== "object" ||
        typeof ctx.cwd !== "string" ||
        ctx.cwd.length === 0
      ) {
        throw new TypeError("Pi read execution requires ctx.cwd");
      }
      // Pi's ctx itself is the host: no copy, no spread, no freeze.
      const call: ReadContext<ExtensionContext> = {
        ...(signal === undefined ? {} : { signal }),
        callId: toolCallId,
        host: ctx,
      };
      const result = await read(signature.toRead(input), call);
      return {
        content: result.content.map(toPiPart),
        details: toPiReadDetails(
          result,
          viewOf(formatter, result, { digest, limits, mode: "view", call }),
          limits.maxViewBytes,
        ),
      };
    },
  });
}

/** The body in "view" mode, with the same call object. null for parts or a non-ok result. */
function viewOf(
  formatter: Formatter<ExtensionContext>,
  result: ReadResult,
  ctx: FormatContext<ExtensionContext>,
): string | null {
  if (result.status !== "ok") return null;
  const { content: _content, ...outcome } = result;
  const view = formatter.format(outcome, ctx);
  return typeof view === "string" ? view : null;
}

/**
 * One case for each ContentPart type. Pi's tool content takes images only, so
 * other media becomes a text part that says what was left out.
 */
function toPiPart(part: ContentPart): PiContentPart {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "media":
      if (!part.mediaType.startsWith("image/")) {
        return {
          type: "text",
          text: `[read:media-omitted] ${part.mediaType} (${part.data.byteLength} bytes) cannot be shown in Pi.`,
        };
      }
      return {
        type: "image",
        data: Buffer.from(part.data.buffer, part.data.byteOffset, part.data.byteLength).toString(
          "base64",
        ),
        mimeType: part.mediaType,
      };
  }
}

/**
 * One filesystem for each resolved root, at most MAX_CACHED_ROOTS. The oldest
 * insertion goes first. An evicted root is rebuilt on its next call.
 */
function rootCache(build: (root: string) => FileSystem): (root: string) => FileSystem {
  const cache = new Map<string, FileSystem>();
  return (root) => {
    const cached = cache.get(root);
    if (cached !== undefined) return cached;
    const fs = build(root);
    if (cache.size >= MAX_CACHED_ROOTS) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(root, fs);
    return fs;
  };
}
