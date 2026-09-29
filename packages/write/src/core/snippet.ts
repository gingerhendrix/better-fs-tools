import type { WriteLimits } from "../contract/limits.ts";
import type { Snippet } from "../contract/result.ts";
import { LineIndex } from "./line-index.ts";

const MAX_SNIPPET_LINE_LENGTH = 2_000;

export function buildSnippets(
  after: string | LineIndex,
  ranges: readonly (readonly [number, number])[],
  limits: Readonly<WriteLimits>,
): Snippet[] {
  const index = typeof after === "string" ? new LineIndex(after) : after;
  const total = index.count;
  if (total === 0) return [];
  const windows: [number, number][] = [];
  for (const [first, last] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const from = Math.max(1, Math.min(first, total) - limits.snippetLines);
    const to = Math.min(total, Math.max(last, first) + limits.snippetLines);
    const previous = windows.at(-1);
    if (previous !== undefined && from <= previous[1] + 1) previous[1] = Math.max(previous[1], to);
    else windows.push([from, to]);
  }
  const snippets: Snippet[] = [];
  let left = limits.maxSnippetLines;
  for (const [from, to] of windows) {
    if (left <= 0) break;
    const last = Math.min(to, from + left - 1);
    const lines: string[] = [];
    for (let line = from; line <= last; line += 1) lines.push(clamp(index.line(line)));
    snippets.push({ startLine: from, lines });
    left -= lines.length;
  }
  return snippets;
}

function clamp(line: string): string {
  if (line.length <= MAX_SNIPPET_LINE_LENGTH) return line;
  return `${line.slice(0, MAX_SNIPPET_LINE_LENGTH)}… [line truncated at ${MAX_SNIPPET_LINE_LENGTH} chars]`;
}
