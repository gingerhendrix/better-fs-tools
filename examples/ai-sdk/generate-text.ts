import { generateText, isStepCount } from "ai";
import type { LanguageModel } from "ai";
import { createAiSdkReadTool } from "@better-fs-tools/ai-sdk";
import { nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { defaultReadSignature } from "@better-fs-tools/read/signature";

const cwd = process.cwd();
const read = createAiSdkReadTool({
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
  digest: nodeDigest(),
  signature: defaultReadSignature({
    name: "read_file",
    names: { path: "file_path", offset: "start_line", limit: "max_lines" },
  }),
});

export async function ask(model: LanguageModel, prompt: string): Promise<string> {
  const result = await generateText({
    model,
    prompt,
    tools: { [read.name]: read },
    stopWhen: isStepCount(5),
  });
  return result.text;
}
