/**
 * Type tests. `tsc -b` checks this file through the package tsconfig. Bun never
 * runs it: the name does not match Bun's test file pattern.
 */
import type { Tool, ToolExecutionOptions, ToolSet } from "ai";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { lineNumberFormatter } from "@better-fs-tools/read";
import type { ReadFormatter, JsonObject, ReadContext, ReadResult } from "@better-fs-tools/read";

import { createAiSdkReadTool } from "../../src/index.ts";
import type { AiSdkReadOutput, AiSdkReadTool } from "../../src/index.ts";

const fs = memoryFileSystem();

// AiSdkReadTool is assignable to the ai Tool type and fits a ToolSet.
declare const read: AiSdkReadTool;
export const asTool: Tool<JsonObject, ReadResult, unknown> = read;
export const inSet: ToolSet = { read };
declare const contextual: AiSdkReadTool<{ user: string }>;
export const asContextTool: Tool<JsonObject, ReadResult, { user: string }> = contextual;
type ModelOutput = Awaited<
  ReturnType<NonNullable<Tool<JsonObject, ReadResult, unknown>["toModelOutput"]>>
>;
declare const output: AiSdkReadOutput;
export const asOutput: ModelOutput = output;

// The host type is ToolExecutionOptions<C>, so the context is typed.
export const typed = createAiSdkReadTool<{ user: string }>({
  fs: (call) => {
    const user: string = call.host.context.user;
    void user;
    return fs;
  },
});
createAiSdkReadTool<{ user: string }>({
  // @ts-expect-error the context has no session field
  fs: (call) => (call.host.context.session === "" ? fs : fs),
});

// Host-free helpers typed with unknown fit an AI SDK tool.
export const unknownFormatter = createAiSdkReadTool<{ user: string }>({
  fs,
  formatter: lineNumberFormatter(),
});
export const unknownFactory = createAiSdkReadTool<{ user: string }>({
  fs: (_call: ReadContext<unknown>) => fs,
});
declare const hostFormatter: ReadFormatter<ToolExecutionOptions<{ user: string }>>;
export const hostTyped = createAiSdkReadTool<{ user: string }>({ fs, formatter: hostFormatter });

// fs is required, as in the core.
// @ts-expect-error fs is missing
createAiSdkReadTool({});
