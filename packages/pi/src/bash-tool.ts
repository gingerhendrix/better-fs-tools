import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import type { JsonObject, ToolCallContext } from "@better-fs-tools/read";
import { bashToolDefinition } from "@better-fs-tools/shell/signature";
import type {
  BashToolDefinition,
  BashToolDefinitionOptions,
} from "@better-fs-tools/shell/signature";

import { toPiPart } from "./parts.ts";
import type { PiContentPart } from "./parts.ts";
import { checkPiOptions, piPrompt, splitPrompt } from "./prompt.ts";
import type { PiPromptOptions } from "./prompt.ts";
import { piBashArgs, setRenderArgs } from "./renderers.ts";

/**
 * Options for createPiBashTool: the options of bashToolDefinition(), with the
 * Pi extension context as host, plus the Pi prompt options. `runner` and `env`
 * are required: piCwdCommandRunner() from `./node` runs commands in ctx.cwd.
 */
export type PiBashToolOptions = BashToolDefinitionOptions<ExtensionContext> & PiPromptOptions;

/** Pi's BashToolDetails shape, so Pi's bash renderer can show the saved output. */
export interface PiBashDetails {
  fullOutputPath?: string;
}

export interface PiBashToolResult {
  content: PiContentPart[];
  details: PiBashDetails | undefined;
  /** true for a nonzero exit, a timeout, and an error. */
  isError: boolean;
}

/** Assignable to ToolDefinition<TSchema, PiBashDetails | undefined> from Pi 1.x. */
export interface PiBashTool {
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
  ): Promise<PiBashToolResult>;
}

/**
 * Creates a Pi bash tool with the options and defaults of createBashTool().
 * The Pi extension does not register this tool, so Pi's own bash stays in
 * place unless you register it.
 */
export function createPiBashTool(options: PiBashToolOptions): PiBashTool {
  checkPiOptions(options, "Pi bash tool");
  const { prompt, rest } = splitPrompt(options);
  return adaptPiBashTool(bashToolDefinition<ExtensionContext>(rest), prompt);
}

export function adaptPiBashTool(
  definition: BashToolDefinition<ExtensionContext>,
  prompt: PiPromptOptions,
): PiBashTool {
  const { signature } = definition;
  const tool = Object.freeze<PiBashTool>({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    ...piPrompt(prompt, definition.description),
    parameters: Type.Unsafe(definition.inputSchema),
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      const call: ToolCallContext<ExtensionContext> = {
        ...(signal === undefined ? {} : { signal }),
        callId: toolCallId,
        host: ctx,
      };
      const result = await definition.execute(input, call);
      const spill = result.output?.spill ?? null;
      return {
        content: result.content.map((part) => toPiPart(part, "bash")),
        details: spill === null ? undefined : { fullOutputPath: spill },
        isError: result.status !== "ok",
      };
    },
  });
  setRenderArgs(tool, (args) => signature.toInput(args), piBashArgs);
  return tool;
}
