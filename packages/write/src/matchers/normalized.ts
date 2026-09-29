import type { Matcher, MatchContext, MatchRange } from "../contract/matcher.ts";
import { FIRST, LAST, fold } from "./fold.ts";
import type { Folded } from "./fold.ts";
import { memoizeLast } from "./lines.ts";

const LF = 10;

/**
 * Matches while ignoring trailing whitespace, Unicode normalization, curly
 * quotes, dashes, and special spaces. A match that starts or ends inside one
 * folded character is refused.
 */
export function normalizedMatcher(): Matcher {
  const folded = memoizeLast(fold);
  return Object.freeze<Matcher>({
    id: "normalized",
    fuzzy: true,
    describe:
      "trailing whitespace, Unicode normalization, curly quotes, dashes, and special spaces",
    find: (haystack, needle, ctx) => findFolded(haystack, folded(haystack), fold(needle), ctx),
  });
}

function findFolded(
  haystack: string,
  hay: Folded,
  needle: Folded,
  ctx: MatchContext,
): MatchRange[] {
  const ranges: MatchRange[] = [];
  const text = hay.text;
  if (needle.text === "") return ranges;
  let from = firstUnitAtOrAfter(hay, ctx.from);
  while (ranges.length < ctx.maxMatches) {
    const first = text.indexOf(needle.text, from);
    if (first === -1) break;
    const end = first + needle.text.length;
    const range = originalRange(haystack, hay, first, end, needle.trimmedEnd, ctx);
    if (range === null || range.start < ctx.from) {
      from = first + 1;
      continue;
    }
    ranges.push(range);
    from = end;
  }
  return ranges;
}

function originalRange(
  haystack: string,
  hay: Folded,
  first: number,
  end: number,
  trimmedEnd: boolean,
  ctx: MatchContext,
): MatchRange | null {
  const text = hay.text;
  const lineEnd = end === text.length || text.charCodeAt(end) === LF;
  if (trimmedEnd && !lineEnd) return null;
  let start = hay.sourceStart[first] ?? 0;
  let stop = hay.sourceEnd[end - 1] ?? 0;
  if (ctx.mode === "lines") {
    const endsLine = lineEnd || text.charCodeAt(end - 1) === LF;
    if (!(first === 0 || text.charCodeAt(first - 1) === LF) || !endsLine) return null;
    start = first === 0 ? 0 : (hay.sourceEnd[first - 1] ?? 0);
  }
  if ((ctx.mode === "lines" || trimmedEnd) && text.charCodeAt(end - 1) !== LF) {
    stop = end === text.length ? haystack.length : (hay.sourceStart[end] ?? 0);
  }
  const inside = !((hay.edges[first] ?? 0) & FIRST) || !((hay.edges[end - 1] ?? 0) & LAST);
  return inside ? { start, end: stop, refused: "boundary" } : { start, end: stop };
}

function firstUnitAtOrAfter(hay: Folded, from: number): number {
  let low = 0;
  let high = hay.sourceStart.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((hay.sourceStart[middle] ?? 0) < from) low = middle + 1;
    else high = middle;
  }
  return low;
}
