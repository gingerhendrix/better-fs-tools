import type { Matcher, MatchRange } from "../contract/matcher.ts";
import { LineTable, lastValue, needleLines } from "./lines.ts";

/**
 * For a needle of 3 or more lines: a window whose first and last lines equal
 * the needle's first and last lines after trimming, where at least half of
 * the needle's middle lines appear (trimmed) among the window's middle lines.
 * The window holds at most `maxSpanRatio` times the needle's line count.
 * Anchors must not be blank. For each start line the shortest window wins.
 */
export function blockAnchorMatcher(options: { readonly maxSpanRatio?: number } = {}): Matcher {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("blockAnchorMatcher options must be an object");
  }
  const { maxSpanRatio = 3 } = options;
  if (typeof maxSpanRatio !== "number" || !Number.isFinite(maxSpanRatio) || maxSpanRatio < 1) {
    throw new TypeError("maxSpanRatio must be a finite number of at least 1");
  }
  const table = lastValue((text) => new LineTable(text));
  return Object.freeze<Matcher>({
    id: "block-anchor",
    fuzzy: true,
    describe: "lines between matching first and last lines",
    find(haystack, needle, ctx) {
      const { lines, withBreak } = needleLines(needle);
      const wanted = lines.map((line) => line.trim());
      const head = wanted[0] ?? "";
      const tail = wanted.at(-1) ?? "";
      if (wanted.length < 3 || head === "" || tail === "") return [];
      const middle = wanted.slice(1, -1);
      const needed = Math.ceil(middle.length / 2);
      const span = Math.floor(maxSpanRatio * wanted.length);
      const hay = table(haystack);
      const trimmed = hay.trimmed;
      const ranges: MatchRange[] = [];
      for (let first = hay.firstFrom(ctx.from); first < hay.count; first += 1) {
        if (ranges.length >= ctx.maxMatches) break;
        if (trimmed[first] !== head) continue;
        const limit = Math.min(hay.count - 1, first + span - 1);
        for (let last = first + 2; last <= limit; last += 1) {
          if (trimmed[last] !== tail) continue;
          if (shared(middle, trimmed.slice(first + 1, last)) < needed) continue;
          const range = hay.range(first, last, withBreak);
          if (range === null) continue;
          ranges.push(range);
          first = last;
          break;
        }
      }
      return ranges;
    },
  });
}

/** How many needle lines pair with a distinct equal window line. */
function shared(needle: readonly string[], window: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const line of window) counts.set(line, (counts.get(line) ?? 0) + 1);
  let found = 0;
  for (const line of needle) {
    const left = counts.get(line) ?? 0;
    if (left === 0) continue;
    counts.set(line, left - 1);
    found += 1;
  }
  return found;
}
