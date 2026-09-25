import type { ReadContext } from "../contract/context.ts";
import type { Dependencies } from "../contract/deps.ts";
import type { ContentPart, ReadOutcome, ReadResult } from "../contract/result.ts";

/**
 * Runs the formatter last, in "model" mode. A string becomes one text part.
 * A formatter exception propagates: the core cannot format a failure without it.
 */
export function formatResult<THost>(
  deps: Dependencies<THost>,
  call: ReadContext<THost>,
  outcome: ReadOutcome,
): ReadResult {
  const output = deps.formatter.format(outcome, {
    digest: deps.digest,
    limits: deps.limits,
    mode: "model",
    call,
  });
  if (typeof output === "string") return { ...outcome, content: [{ type: "text", text: output }] };
  if (!Array.isArray(output)) {
    throw new TypeError(`formatter ${deps.formatter.id} must return a string or an array`);
  }
  const content: readonly ContentPart[] = [...output];
  return { ...outcome, content };
}

/** Joins the text parts of `result.content` with "\n". */
export function textOf(result: ReadResult): string {
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
