import type { Matcher, MatchRange } from "../contract/matcher.ts";
import { LineTable, lastValue, needleLines } from "./lines.ts";

/**
 * Removes the common indent of the needle and of each window of haystack
 * lines, then compares the lines exactly. Blank lines match blank lines. A
 * hit covers whole lines, as in lineTrimmedMatcher. `adapt` shifts each line
 * of the new text by the difference between the two indents.
 */
export function indentationMatcher(): Matcher {
  const table = lastValue((text) => new LineTable(text));
  return Object.freeze<Matcher>({
    id: "indentation",
    fuzzy: true,
    describe: "a different indentation level",
    find(haystack, needle, ctx) {
      const { lines, withBreak } = needleLines(needle);
      if (lines.every(isBlank)) return [];
      const indent = commonIndent(lines);
      const wanted = lines.map((line) => (isBlank(line) ? "" : line.slice(indent.length)));
      const wantedTrimmed = lines.map((line) => line.trim());
      const hay = table(haystack);
      const trimmed = hay.trimmed;
      const ranges: MatchRange[] = [];
      const last = hay.count - lines.length;
      for (let first = hay.firstFrom(ctx.from); first <= last; first += 1) {
        if (ranges.length >= ctx.maxMatches) break;
        // Equal dedented lines have equal trimmed lines: a cheap filter first.
        if (!wantedTrimmed.every((line, offset) => trimmed[first + offset] === line)) continue;
        const window = wanted.map((_, offset) => hay.line(first + offset));
        const shift = commonIndent(window);
        const same = window.every((line, offset) =>
          isBlank(line) ? wanted[offset] === "" : line.slice(shift.length) === wanted[offset],
        );
        if (!same) continue;
        const range = hay.range(first, first + lines.length - 1, withBreak);
        if (range === null) continue;
        ranges.push(range);
        first += lines.length - 1;
      }
      return ranges;
    },
    adapt(newText, hit) {
      const from = commonIndent(needleLines(hit.needle).lines);
      const to = commonIndent(
        needleLines(hit.haystack.slice(hit.range.start, hit.range.end)).lines,
      );
      if (from === to) return newText;
      return newText
        .split("\n")
        .map((line) => reindent(line, from, to))
        .join("\n");
    },
  });
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** The longest run of leading spaces and tabs that every non-blank line shares. */
function commonIndent(lines: readonly string[]): string {
  let common: string | null = null;
  for (const line of lines) {
    if (isBlank(line)) continue;
    const indent = /^[ \t]*/u.exec(line)?.[0] ?? "";
    if (common === null) {
      common = indent;
      continue;
    }
    let length = 0;
    while (length < common.length && length < indent.length && common[length] === indent[length]) {
      length += 1;
    }
    common = common.slice(0, length);
  }
  return common ?? "";
}

/** Swaps the needle's indent for the matched indent. Other lines keep their relative shape. */
function reindent(line: string, from: string, to: string): string {
  if (isBlank(line)) return line;
  if (line.startsWith(from)) return to + line.slice(from.length);
  if (to.startsWith(from)) return to.slice(from.length) + line;
  const extra = from.length - to.length;
  const leading = /^[ \t]*/u.exec(line)?.[0].length ?? 0;
  return extra > 0 ? line.slice(Math.min(extra, leading)) : line;
}
