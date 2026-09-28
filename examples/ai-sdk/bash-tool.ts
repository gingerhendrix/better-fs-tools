import { generateText, isStepCount } from "ai";
import type { LanguageModel } from "ai";
import { createAiSdkBashTool } from "@better-fs-tools/ai-sdk";
import { nodeCommandRunner } from "@better-fs-tools/node";
import { shellEnv } from "@better-fs-tools/shell";

// The AI SDK package starts no process. Give it a runner.
const bash = createAiSdkBashTool({
  runner: nodeCommandRunner(),
  env: shellEnv(() => process.env),
});

export async function run(model: LanguageModel, prompt: string): Promise<string> {
  const result = await generateText({
    model,
    prompt,
    tools: { [bash.name]: bash },
    stopWhen: isStepCount(5),
  });
  return result.text;
}
