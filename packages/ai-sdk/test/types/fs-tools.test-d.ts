import type { ToolSet } from "ai";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { memoryStore } from "@better-fs-tools/read";
import { shellEnv } from "@better-fs-tools/shell";
import type { CommandRunner } from "@better-fs-tools/shell";

import { createAiSdkEditTool, createAiSdkFsTools, createAiSdkReadTool } from "../../src/index.ts";
import type { AiSdkBashTool } from "../../src/index.ts";

declare const runner: CommandRunner;
const fs = memoryFileSystem();

export const set: ToolSet = createAiSdkFsTools({ fs }).tools;

// @ts-expect-error: bash may be null.
export const noBash: AiSdkBashTool = createAiSdkFsTools({ fs }).bash;
export const bash: AiSdkBashTool = createAiSdkFsTools({
  fs,
  bash: { runner, env: shellEnv() },
}).bash;
// @ts-expect-error: this package has no default runner, so bash: true is refused.
createAiSdkFsTools({ fs, bash: true });

// The bundle has a default digest, so a state needs no digest here.
export const withState = createAiSdkFsTools({ fs, state: memoryStore() });

// @ts-expect-error: a state needs a digest.
createAiSdkReadTool({ fs, state: memoryStore() });
// @ts-expect-error: a state needs a digest.
createAiSdkEditTool({ fs, state: memoryStore() });
