import { appendFile } from "node:fs/promises";

import { isStepCount, streamText } from "ai";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";

import { addStep, addUsage, emptyMetrics } from "./metrics.ts";
import type { RunMetrics, StepPart } from "./metrics.ts";

export type EndState = "done" | "matched" | "max-steps" | "error";

export interface LoopOptions {
  readonly model: LanguageModel;
  readonly system: string;
  readonly prompt: string;
  readonly tools: ToolSet;
  readonly maxSteps: number;
  /** Abort one model call (with its retries) after this long. */
  readonly stepTimeoutMs: number;
  /** JSONL file that gets one line per step. */
  readonly stepLog: string;
  /** Called after each step with tool results. true stops the loop early (the OMP early stop). */
  readonly isSolved?: () => Promise<boolean>;
}

export interface LoopResult {
  readonly end: EndState;
  readonly error: string | null;
  readonly metrics: RunMetrics;
  readonly finalText: string;
}

/**
 * Runs the agent loop one model call at a time. Each `streamText` call does
 * one step: a model response, then the tool calls in it. The loop appends the
 * response messages and calls again until the model stops calling tools.
 * One step per call keeps a clean per-step log and lets the loop stop early.
 *
 * The loop streams because slow models that write long tool inputs (whole
 * files) run past the Command Code gateway timeout on a non-streaming call.
 */
export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const metrics = emptyMetrics();
  const messages: ModelMessage[] = [{ role: "user", content: options.prompt }];
  let finalText = "";
  for (let step = 0; step < options.maxSteps; step++) {
    let result;
    try {
      result = await oneStep(options, messages);
    } catch (error) {
      const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return { end: "error", error: text, metrics, finalText };
    }
    addUsage(metrics, result.usage);
    const parts = result.content as readonly StepPart[];
    addStep(metrics, parts);
    messages.push(...result.responseMessages);
    finalText = result.text;
    await appendFile(
      options.stepLog,
      `${JSON.stringify({ step, finishReason: result.finishReason, usage: result.usage, content: summarise(parts) })}\n`,
    );
    if (result.toolCalls.length === 0) return { end: "done", error: null, metrics, finalText };
    if (options.isSolved !== undefined && (await options.isSolved())) {
      return { end: "matched", error: null, metrics, finalText };
    }
  }
  return { end: "max-steps", error: null, metrics, finalText };
}

/** One streamed model call. Resolves when the stream ends, and rejects on a stream error. */
async function oneStep(options: LoopOptions, messages: readonly ModelMessage[]) {
  let streamError: unknown = null;
  const stream = streamText({
    model: options.model,
    system: options.system,
    messages: [...messages],
    tools: options.tools,
    stopWhen: isStepCount(1),
    maxRetries: 3,
    abortSignal: AbortSignal.timeout(options.stepTimeoutMs),
    onError: ({ error }) => {
      streamError = error;
    },
  });
  const [content, text, toolCalls, finishReason, usage, responseMessages] = await Promise.all([
    stream.content,
    stream.text,
    stream.toolCalls,
    stream.finishReason,
    stream.usage,
    stream.responseMessages,
  ]);
  if (streamError !== null) throw streamError;
  return { content, text, toolCalls, finishReason, usage, responseMessages };
}

/** Drops model-facing content arrays from tool outputs, which repeat the file text. */
function summarise(parts: readonly StepPart[]): unknown[] {
  return parts.map((part) => {
    if (part.type !== "tool-result" || !("output" in part)) return part;
    const output = part.output;
    if (output === null || typeof output !== "object") return part;
    const { content, ...rest } = output as { content?: unknown };
    return { ...part, output: rest, contentChars: JSON.stringify(content ?? null).length };
  });
}
