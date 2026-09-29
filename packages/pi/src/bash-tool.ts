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
import { checkPiContext, checkPiOptions } from "./roots.ts";

/** Pi 0.84.4's bashToolSystemPromptContribution snippet, so the system prompt is unchanged. */
const BASH_SNIPPET = "Execute bash commands (ls, grep, find, etc.)";
/** Directories whose runners are kept. */
const MAX_CACHED_RUNNERS = 8;

/** No cwd: the directory is bound to ctx.cwd on every call. */
export interface CreatePiBashToolOptions extends Omit<
  ShellToolDeps<ExtensionContext>,
  "runner" | "cwd" | "env"
> {
  /** Default a nodeCommandRunner at ctx.cwd, one for each directory. */
  readonly runner?: ShellToolDeps<ExtensionContext>["runner"];
  /** Default shellEnv(() => process.env): Pi runs commands with the host's environment. */
  readonly env?: ShellToolDeps<ExtensionContext>["env"];
  /**
   * Default defaultBashSignature({ timeoutUnit: "s", cwd: false, limits }):
   * Pi's own shape, { command, timeout } in seconds, so Pi's bash renderer and
   * prompt fit. The description names the configured timeouts and output
   * limits, and a given runner object's id.
   */
  readonly signature?: BashSignature;
  readonly promptSnippet?: string;
  readonly promptGuidelines?: readonly string[];
}

/** Pi's BashToolDetails shape, so Pi's bash renderer can show the saved output. */
export interface PiBashDetails {
  fullOutputPath?: string;
}

export interface PiBashToolResult {
  content: PiContentPart[];
  details: PiBashDetails | undefined;
}

/** Assignable to ToolDefinition<TSchema, PiBashDetails | undefined> from Pi 0.84.2. */
export interface PiBashTool {
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
  ): Promise<PiBashToolResult>;
}

/**
 * The bash tool over ctx.cwd. Throws TypeError on fs, cwd, or allowedRoots
 * in options: the directory is bound to ctx.cwd on every call, also with a
 * supplied runner, whose own cwd is not used. execute throws TypeError when
 * ctx.cwd is not an absolute path. env defaults
 * to process.env with defaultShellEnv over it. The Pi extension entry does
 * not register this tool, so Pi's own bash stays in place unless a host
 * registers it.
 */
export function createPiBashTool(options: CreatePiBashToolOptions = {}): PiBashTool {
  checkPiOptions(options, "bash");
  const {
    signature: given,
    promptSnippet = BASH_SNIPPET,
    promptGuidelines = [],
    runner = piRunners(),
    ...deps
  } = options;
  const runnerId = typeof runner === "function" ? undefined : runner.id;
  const signature =
    given ??
    defaultBashSignature({
      timeoutUnit: "s",
      cwd: false,
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
  return Object.freeze<PiBashTool>({
    name: signature.name,
    label: signature.name,
    description: signature.description,
    promptSnippet,
    promptGuidelines: [...promptGuidelines],
    parameters: Type.Unsafe(signature.schema),
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      checkPiContext(ctx, "bash");
      if (!isAbsolute(ctx.cwd))
        throw new TypeError("Pi bash execution requires an absolute ctx.cwd");
      // Pi's ctx itself is the host: no copy, no spread, no freeze.
      const call: ToolCallContext<ExtensionContext> = {
        ...(signal === undefined ? {} : { signal }),
        callId: toolCallId,
        host: ctx,
      };
      // A tool error is a result, not a throw, as for the other Pi tools.
      const result = await bash(signature.toInput(input), call);
      const spill = result.output?.spill ?? null;
      return {
        content: result.content.map((part) => toPiPart(part, "bash")),
        details: spill === null ? undefined : { fullOutputPath: spill },
      };
    },
  });
}

/** One nodeCommandRunner for each ctx.cwd, the most recent eight kept. */
function piRunners(): (call: ToolCallContext<ExtensionContext>) => CommandRunner {
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
