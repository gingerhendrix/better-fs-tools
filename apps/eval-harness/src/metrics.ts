import type { LanguageModelUsage } from "ai";

/** Counters for one run. Every field is a plain number or string map, so it serialises as is. */
export interface RunMetrics {
  steps: number;
  toolCalls: Record<string, number>;
  /** Tool error codes: `edit:NO_MATCH`, `read:NOT_FOUND`, `edit:schema`, and so on. */
  toolErrors: Record<string, number>;
  /** Note codes from successful and failed results, for example `edit:fuzzy-match`. */
  notes: Record<string, number>;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Characters the model sent as tool input. */
  toolInputChars: number;
}

export function emptyMetrics(): RunMetrics {
  return {
    steps: 0,
    toolCalls: {},
    toolErrors: {},
    notes: {},
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    toolInputChars: 0,
  };
}

/** The content parts of one step that the counters read. */
export type StepPart =
  | { readonly type: "tool-call"; readonly toolName: string; readonly input: unknown }
  | { readonly type: "tool-result"; readonly toolName: string; readonly output: unknown }
  | { readonly type: "tool-error"; readonly toolName: string; readonly error: unknown }
  | { readonly type: string };

export function addUsage(m: RunMetrics, usage: LanguageModelUsage): void {
  m.inputTokens += usage.inputTokens ?? 0;
  m.cachedInputTokens += usage.inputTokenDetails?.cacheReadTokens ?? 0;
  m.outputTokens += usage.outputTokens ?? 0;
  m.reasoningTokens += usage.outputTokenDetails?.reasoningTokens ?? 0;
}

export function addStep(m: RunMetrics, parts: readonly StepPart[]): void {
  m.steps += 1;
  for (const part of parts) {
    if (part.type === "tool-call" && "toolName" in part && "input" in part) {
      bump(m.toolCalls, part.toolName);
      m.toolInputChars += JSON.stringify(part.input ?? null).length;
    } else if (part.type === "tool-result" && "output" in part) {
      countResult(m, part.toolName, part.output);
    } else if (part.type === "tool-error" && "error" in part) {
      bump(m.toolErrors, `${part.toolName}:${errorKind(part.error)}`);
    }
  }
}

/**
 * Better FS Tools results carry `status` and a code. Read failures put the
 * code on the result. Write failures put it on `error.code`.
 */
function countResult(m: RunMetrics, tool: string, output: unknown): void {
  if (output === null || typeof output !== "object") return;
  const o = output as {
    status?: string;
    code?: string;
    error?: { code?: string } | null;
    notes?: readonly { code?: string }[];
  };
  if (o.status === "error" || o.status === "unsupported") {
    bump(m.toolErrors, `${tool}:${o.error?.code ?? o.code ?? "unknown"}`);
  }
  for (const note of o.notes ?? []) {
    if (typeof note.code === "string") bump(m.notes, `${tool}:${note.code}`);
  }
}

/**
 * Errors that never reached the tool, or that the tool threw. AI SDK gives
 * an Error or its message string, so both are matched by text.
 */
export function errorKind(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/JSONParseError|JSON pars/i.test(text)) return "bad-json";
  if (/NoSuchTool/i.test(text)) return "unknown-tool";
  if (/InvalidToolInput|TypeValidation|schema|validat/i.test(text)) return "schema";
  return "thrown";
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function totalErrors(m: RunMetrics): number {
  return Object.values(m.toolErrors).reduce((a, b) => a + b, 0);
}
