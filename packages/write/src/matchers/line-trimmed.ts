import type { Matcher, MatchRange } from "../contract/matcher.ts";
import { LineTable, lastValue, needleLines } from "./lines.ts";

/**
 * Compares whole lines with both ends trimmed. A hit covers whole original
 * lines: without the last line break, or with it when the needle ends with
 * "\n". Hits do not overlap. A needle of blank lines only finds nothing.
 */
export function lineTrimmedMatcher(): Matcher {
  const table = lastValue((text) => new LineTable(text));
  return Object.freeze<Matcher>({
    id: "line-trimmed",
    fuzzy: true,
    describe: "leading and trailing whitespace on each line",
    find(haystack, needle, ctx) {
      const { lines, withBreak } = needleLines(needle);
      const wanted = lines.map((line) => line.trim());
      if (wanted.every((line) => line === "")) return [];
      const hay = table(haystack);
      const trimmed = hay.trimmed;
      const ranges: MatchRange[] = [];
      const last = hay.count - wanted.length;
      for (let first = hay.firstFrom(ctx.from); first <= last; first += 1) {
        if (ranges.length >= ctx.maxMatches) break;
        if (!wanted.every((line, offset) => trimmed[first + offset] === line)) continue;
        const range = hay.range(first, first + wanted.length - 1, withBreak);
        if (range === null) continue;
        ranges.push(range);
        first += wanted.length - 1;
      }
      return ranges;
    },
  });
}
