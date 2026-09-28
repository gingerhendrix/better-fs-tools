/**
 * Type tests. `tsc -b` checks this file through the package tsconfig. Bun never
 * runs it: the name does not match Bun's test file pattern.
 */
import type { Tool, ToolExecutionOptions, ToolSet } from "ai";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { JsonObject } from "@better-fs-tools/read";
import { askBeforeWrite, defaultWriteFormatter, protectPaths } from "@better-fs-tools/write";
import type { Guard, MutationResult, WriteFormatter } from "@better-fs-tools/write";
import { freeformPatchSignature, multiEditSignature } from "@better-fs-tools/write/signature";

import {
  createAiSdkApplyPatchTool,
  createAiSdkEditTool,
  createAiSdkReadTool,
  createAiSdkWriteTool,
} from "../../src/index.ts";
import type { AiSdkMutationTool, AiSdkReadOutput } from "../../src/index.ts";

const fs = memoryFileSystem();

// AiSdkMutationTool is assignable to the ai Tool type and fits a ToolSet with read.
declare const edit: AiSdkMutationTool;
export const asTool: Tool<JsonObject, MutationResult, unknown> = edit;
export const inSet: ToolSet = {
  read: createAiSdkReadTool({ fs }),
  edit,
  write: createAiSdkWriteTool({ fs }),
  apply_patch: createAiSdkApplyPatchTool({ fs }),
};
declare const contextual: AiSdkMutationTool<{ user: string }>;
export const asContextTool: Tool<JsonObject, MutationResult, { user: string }> = contextual;
type ModelOutput = Awaited<
  ReturnType<NonNullable<Tool<JsonObject, MutationResult, unknown>["toModelOutput"]>>
>;
declare const output: AiSdkReadOutput;
export const asOutput: ModelOutput = output;

// The host type is ToolExecutionOptions<C>, so the context is typed.
export const typed = createAiSdkEditTool<{ user: string }>({
  fs: (call) => {
    const user: string = call.host.context.user;
    void user;
    return fs;
  },
  signature: multiEditSignature(),
});
createAiSdkWriteTool<{ user: string }>({
  // @ts-expect-error the context has no session field
  fs: (call) => (call.host.context.session === "" ? fs : fs),
});

// Host-free helpers typed with unknown fit, and so do host-typed ones.
declare const hostGuard: Guard<ToolExecutionOptions<{ user: string }>>;
declare const hostFormatter: WriteFormatter<ToolExecutionOptions<{ user: string }>>;
export const helpers = createAiSdkApplyPatchTool<{ user: string }>({
  fs,
  signature: freeformPatchSignature(),
  authorize: protectPaths(),
  guards: [hostGuard],
  formatter: hostFormatter,
});
export const unknownFormatter = createAiSdkWriteTool<{ user: string }>({
  fs,
  formatter: defaultWriteFormatter(),
  authorize: askBeforeWrite(async (_plan, ctx) => ctx.call.host.context.user === "admin"),
});

// fs is required, as in the core.
// @ts-expect-error fs is missing
createAiSdkEditTool({});
