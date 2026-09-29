import type { Matcher, MatchRange } from "../contract/matcher.ts";
import { LineTable, memoizeLast, needleLines } from "./lines.ts";

/** Matches whole lines, ignoring leading and trailing whitespace on each line. */
export function lineTrimmedMatcher(): Matcher {
  const table = memoizeLast((text) => new LineTable(text));
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
      for (let first = hay.firstLineAtOrAfter(ctx.from); first <= last; first += 1) {
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
