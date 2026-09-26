import type { Formatter } from "../contract/format.ts";
import type { ReadOutcome } from "../contract/result.ts";
import { plainFormatter } from "../formatters/plain.ts";
import { isDirectory, preset } from "./shared.ts";

/**
 * Deep Agents style: the source with no gutter between two range lines,
 * `@@ lines 1-100 of 250 | next offset 101 @@`. The offset is canonical
 * (one-based). The total is left out when the scan stopped before EOF.
 */
export function deepAgentsFormat(): Formatter<unknown> {
  return preset("deep-agents", plainFormatter({ header: range, footer: range }));
}

function range(outcome: ReadOutcome): string | null {
  if (outcome.status !== "ok") return null;
  const noun = isDirectory(outcome) ? "entries" : "lines";
  const { lines } = outcome.view;
  const first = lines[0];
  const last = lines.at(-1);
  const shown = first && last ? `${noun} ${first.number}-${last.number}` : `no ${noun}`;
  const total = outcome.totals.lines === null ? "" : ` of ${outcome.totals.lines}`;
  const offset = outcome.continuation.next?.offset;
  const next = offset === undefined ? "" : ` | next offset ${offset}`;
  return `@@ ${shown}${total}${next} @@`;
}
