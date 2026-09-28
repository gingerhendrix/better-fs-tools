import { appendFile } from "node:fs/promises";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const COMMAND_CODE_BASE_URL = "https://api.commandcode.ai/provider/v1";

export function commandCodeApiKey(): string {
  const key = process.env.COMMANDCODE_API_KEY ?? process.env.AA_COMMANDCODE_API_KEY;
  if (key === undefined || key === "") {
    throw new Error("set COMMANDCODE_API_KEY (or AA_COMMANDCODE_API_KEY)");
  }
  return key;
}

/**
 * A Command Code chat-completions model. When `httpLog` is set, every request
 * and response body goes to that JSONL file, so a run can be audited later.
 */
export function commandCodeModel(modelId: string, httpLog?: string): LanguageModel {
  const provider = createOpenAICompatible({
    name: "commandcode",
    baseURL: COMMAND_CODE_BASE_URL,
    apiKey: commandCodeApiKey(),
    includeUsage: true,
    ...(httpLog === undefined ? {} : { fetch: loggingFetch(httpLog) }),
  });
  return provider.chatModel(modelId);
}

function loggingFetch(file: string): typeof fetch {
  const wrapped = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const started = Date.now();
    const response = await fetch(input, init);
    const body = await response.clone().text();
    await appendFile(
      file,
      `${JSON.stringify({
        at: new Date(started).toISOString(),
        ms: Date.now() - started,
        url: String(input instanceof Request ? input.url : input),
        status: response.status,
        request: typeof init?.body === "string" ? safeJson(init.body) : null,
        response: safeJson(body),
      })}\n`,
    );
    return response;
  };
  return wrapped as typeof fetch;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
