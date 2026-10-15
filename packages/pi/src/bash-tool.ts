import { isAbsolute } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import { nodeCommandRunner } from "@better-fs-tools/node";
import type { JsonObject, ToolCallContext } from "@better-fs-tools/read";
import { createBashTool, shellEnv } from "@better-fs-tools/shell";
import type { CommandRunner, ShellToolDeps } from "@better-fs-tools/shell";
import { bashSignatureMessages, defaultBashSignature } from "@better-fs-tools/shell/signature";
import type { BashSignature } from "@better-fs-tools/shell/signature";

import { toPiPart } from "./parts.ts";
import type { PiContentPart } from "./parts.ts";
import { signatureSnippet } from "./prompt.ts";
import { piBashArgs, setRenderArgs } from "./renderers.ts";
import { checkPiContext, checkPiOptions } from "./roots.ts";

const MAX_CACHED_RUNNERS = 8;

/** Options for createPiBashTool. Commands run in ctx.cwd, or in the cwd that the model gives. */
export interface CreatePiBashToolOptions extends Omit<
  ShellToolDeps<ExtensionContext>,
  "runner" | "cwd" | "env"
> {
  /** Default a nodeCommandRunner at ctx.cwd. */
  readonly runner?: ShellToolDeps<ExtensionContext>["runner"];
  /** Default process.env with defaultShellEnv over it. */
  readonly env?: ShellToolDeps<ExtensionContext>["env"];
  /**
   * Default defaultBashSignature(), as in every integration: { command,
   * timeout?, cwd? } with the timeout in milliseconds. Its description names
   * the configured timeouts, output limits, and runner id.
   */
  readonly signature?: BashSignature;
  /** Default the first sentence of the signature description. Pi lists the tool with it. */
  readonly promptSnippet?: string;
  /** Default []. */
  readonly promptGuidelines?: readonly string[];
}

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
 * Creates a Pi bash tool that runs commands in ctx.cwd, also with your own
 * runner. Throws TypeError when options set fs, cwd, or allowedRoots, and
 * execute throws TypeError when ctx.cwd is not an absolute path. The Pi
 * extension does not register this tool, so Pi's own bash stays in place
 * unless you register it.
 */
export function createPiBashTool(options: CreatePiBashToolOptions = {}): PiBashTool {
  checkPiOptions(options, "bash");
  const {
    signature: given,
    promptSnippet,
    promptGuidelines = [],
    runner = recentRunnerPerCwd(),
    ...deps
  } = options;
  const runnerId = typeof runner === "function" ? undefined : runner.id;
  const signature =
    given ??
    defaultBashSignature({
      ...(runnerId === undefined ? {} : { runner: runnerId }),
      ...(deps.limits === undefined ? {} : { limits: deps.limits }),
    });
  const bash = createBashTool<ExtensionContext>({
    ...deps,
    runner,
    cwd: (call) => call.host.cwd,
    env: deps.env ?? shellEnv(() => process.env),
    messages: { ...bashSignatureMessages(signature), ...deps.messages },
  });
  const tool = Object.freeze<PiBashTool>({
    name: signature.name,
    label: signature.name,
    description: signature.description,
    promptSnippet: promptSnippet ?? signatureSnippet(signature.description),
    promptGuidelines: [...promptGuidelines],
    parameters: Type.Unsafe(signature.schema),
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      checkPiContext(ctx, "bash");
      if (!isAbsolute(ctx.cwd))
        throw new TypeError("Pi bash execution requires an absolute ctx.cwd");
      const call: ToolCallContext<ExtensionContext> = {
        ...(signal === undefined ? {} : { signal }),
        callId: toolCallId,
        host: ctx,
      };
      const result = await bash(signature.toInput(input), call);
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

function recentRunnerPerCwd(): (call: ToolCallContext<ExtensionContext>) => CommandRunner {
  const cache = new Map<string, CommandRunner>();
  return (call) => {
    const cwd = call.host.cwd;
    const cached = cache.get(cwd);
    if (cached !== undefined) {
      cache.delete(cwd);
      cache.set(cwd, cached);
      return cached;
    }
    const made = nodeCommandRunner({ cwd });
    cache.set(cwd, made);
    if (cache.size > MAX_CACHED_RUNNERS) cache.delete(cache.keys().next().value as string);
    return made;
  };
}
