import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import type { JsonObject, ReadContext } from "@better-fs-tools/read";
import { readToolDefinition } from "@better-fs-tools/read/signature";
import type {
  ReadToolDefinition,
  ReadToolDefinitionOptions,
} from "@better-fs-tools/read/signature";

import { toPiReadDetails, viewOf } from "./details.ts";
import type { PiReadDetails } from "./details.ts";
import { toPiPart } from "./parts.ts";
import type { PiContentPart } from "./parts.ts";
import { checkPiOptions, piPrompt, splitPrompt } from "./prompt.ts";
import type { PiPromptOptions } from "./prompt.ts";
import { canonicalArgs, setRenderArgs } from "./renderers.ts";
import { PI_READ_ANNOTATIONS } from "./results.ts";
import type { PiToolAnnotations } from "./results.ts";

export type { PiContentPart } from "./parts.ts";

/**
 * Options for createPiReadTool: the options of readToolDefinition(), with the
 * Pi extension context as host, plus the Pi prompt options. `fs` is required:
 * piCwdFileSystem() from `./node` roots it at ctx.cwd.
 */
export type PiReadToolOptions = ReadToolDefinitionOptions<ExtensionContext> & PiPromptOptions;

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
 * Creates a Pi read tool with the options and defaults of createReadTool().
 * The call's host is the Pi extension context.
 */
export function createPiReadTool(options: PiReadToolOptions): PiReadTool {
  checkPiOptions(options, "Pi read tool");
  const { prompt, rest } = splitPrompt(options);
  return adaptPiReadTool(readToolDefinition<ExtensionContext>(rest), prompt);
}

export function adaptPiReadTool(
  definition: ReadToolDefinition<ExtensionContext>,
  prompt: PiPromptOptions,
): PiReadTool {
  const { signature, limits, formatter, digest } = definition;
  const tool = Object.freeze<PiReadTool>({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    ...piPrompt(prompt, definition.description),
    parameters: Type.Unsafe(definition.inputSchema),
    annotations: { ...PI_READ_ANNOTATIONS },
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      const call: ReadContext<ExtensionContext> = {
        ...(signal === undefined ? {} : { signal }),
        callId: toolCallId,
        host: ctx,
      };
      const result = await definition.execute(input, call);
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
