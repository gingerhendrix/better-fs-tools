import { generateText, isStepCount } from "ai";
import type { LanguageModel } from "ai";
import { createAiSdkFsTools } from "@better-fs-tools/ai-sdk";
import { nodeFileSystem } from "@better-fs-tools/node";

const cwd = process.cwd();
// read, edit, write, and apply_patch over one filesystem, with one store,
// one digest, and one lock manager. No bash: this bundle starts no process.
const { tools } = createAiSdkFsTools({ fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }) });

export async function change(model: LanguageModel, prompt: string): Promise<string> {
  const result = await generateText({ model, prompt, tools, stopWhen: isStepCount(10) });
  return result.text;
}
