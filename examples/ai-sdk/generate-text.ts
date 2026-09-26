import { generateText, isStepCount } from "ai";
import type { LanguageModel } from "ai";
import { createAiSdkReadTool } from "@better-fs-tools/ai-sdk";
import { nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { lineRangeSignature } from "@better-fs-tools/read/signature";

const cwd = process.cwd();
const read = createAiSdkReadTool({
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
  digest: nodeDigest(),
  signature: lineRangeSignature({
    name: "read_file",
    names: { path: "file_path", start: "start_line", end: "end_line" },
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
