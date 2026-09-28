import type { ContentPart, ToolCallContext } from "@better-fs-tools/read";

import type { WriteDependencies } from "../contract/deps.ts";
import type { MutationReport, MutationResult } from "../contract/result.ts";

/**
 * Runs the formatter last, in "model" mode. A string becomes one text part.
 * A formatter exception propagates: the core cannot format a failure without it.
 */
export function formatResult<THost>(
  deps: WriteDependencies<THost>,
  call: ToolCallContext<THost>,
  report: MutationReport,
): MutationResult {
  const output = deps.formatter.format(report, {
    digest: deps.digest,
    limits: deps.limits,
    mode: "model",
    call,
  });
  if (typeof output === "string") return { ...report, content: [{ type: "text", text: output }] };
  if (!Array.isArray(output)) {
    throw new TypeError(`formatter ${deps.formatter.id} must return a string or an array`);
  }
  const content: readonly ContentPart[] = [...output];
  return { ...report, content };
}
