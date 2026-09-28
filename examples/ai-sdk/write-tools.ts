import { generateText, isStepCount } from "ai";
import type { LanguageModel } from "ai";
import {
  createAiSdkApplyPatchTool,
  createAiSdkEditTool,
  createAiSdkReadTool,
  createAiSdkWriteTool,
} from "@better-fs-tools/ai-sdk";
import { nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { createMemoryStore } from "@better-fs-tools/read/state";
import { memoryLocks } from "@better-fs-tools/write";

const cwd = process.cwd();
// One filesystem, store, and digest for all four tools. One lock manager for the three writers.
const shared = {
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
  state: createMemoryStore(),
  digest: nodeDigest(),
};
const locks = memoryLocks();

const read = createAiSdkReadTool(shared);
const edit = createAiSdkEditTool({ ...shared, locks });
const write = createAiSdkWriteTool({ ...shared, locks });
const applyPatch = createAiSdkApplyPatchTool({ ...shared, locks });

export async function change(model: LanguageModel, prompt: string): Promise<string> {
  const result = await generateText({
    model,
    prompt,
    tools: {
      [read.name]: read,
      [edit.name]: edit,
      [write.name]: write,
      [applyPatch.name]: applyPatch,
    },
    stopWhen: isStepCount(10),
  });
  return result.text;
}
