import type { Tool, ToolExecutionOptions, ToolSet } from "ai";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { lineNumberFormatter } from "@better-fs-tools/read";
import type { ReadFormatter, JsonObject, ReadContext, ReadResult } from "@better-fs-tools/read";

import { createAiSdkReadTool } from "../../src/index.ts";
import type { AiSdkToolOutput, AiSdkReadTool } from "../../src/index.ts";

const fs = memoryFileSystem();

declare const read: AiSdkReadTool;
export const asTool: Tool<JsonObject, ReadResult, unknown> = read;
export const inSet: ToolSet = { read };
declare const contextual: AiSdkReadTool<{ user: string }>;
export const asContextTool: Tool<JsonObject, ReadResult, { user: string }> = contextual;
type ModelOutput = Awaited<
  ReturnType<NonNullable<Tool<JsonObject, ReadResult, unknown>["toModelOutput"]>>
>;
declare const output: AiSdkToolOutput;
export const asOutput: ModelOutput = output;

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

export const unknownFormatter = createAiSdkReadTool<{ user: string }>({
  fs,
  formatter: lineNumberFormatter(),
});
export const unknownFactory = createAiSdkReadTool<{ user: string }>({
  fs: (_call: ReadContext<unknown>) => fs,
});
declare const hostFormatter: ReadFormatter<ToolExecutionOptions<{ user: string }>>;
export const hostTyped = createAiSdkReadTool<{ user: string }>({ fs, formatter: hostFormatter });

// @ts-expect-error fs is missing
createAiSdkReadTool({});
