import type { Matcher, MatchContext, MatchRange } from "../contract/matcher.ts";
import { FIRST, LAST, fold } from "./fold.ts";
import type { Folded } from "./fold.ts";
import { lastValue } from "./lines.ts";

const LF = 10;

/**
 * Folds haystack and needle the same way (see fold.ts), searches the folded
 * text, and maps each hit back to the original. A hit whose first or last
 * unit falls inside a span that folded to more than one unit is marked
 * `refused: "boundary"`: the core refuses it rather than guess.
 */
export function normalizedMatcher(): Matcher {
  const folded = lastValue(fold);
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
  let from = firstUnitFrom(hay, ctx.from);
  while (ranges.length < ctx.maxMatches) {
    const first = text.indexOf(needle.text, from);
    if (first === -1) break;
    const end = first + needle.text.length;
    const range = mapBack(haystack, hay, first, end, needle.trimmedEnd, ctx);
    if (range === null || range.start < ctx.from) {
      from = first + 1;
      continue;
    }
    ranges.push(range);
    from = end;
  }
  return ranges;
}

/**
 * Original offsets for folded units first..end. A needle that lost trailing
 * blanks at its end must end at a line end, and then the range takes the
 * original's trailing blanks too. In "lines" mode the range runs from the
 * line start to the line end.
 */
function mapBack(
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
  let start = hay.start[first] ?? 0;
  let stop = hay.end[end - 1] ?? 0;
  if (ctx.mode === "lines") {
    const endsLine = lineEnd || text.charCodeAt(end - 1) === LF;
    if (!(first === 0 || text.charCodeAt(first - 1) === LF) || !endsLine) return null;
    start = first === 0 ? 0 : (hay.end[first - 1] ?? 0);
  }
  if ((ctx.mode === "lines" || trimmedEnd) && text.charCodeAt(end - 1) !== LF) {
    stop = end === text.length ? haystack.length : (hay.start[end] ?? 0);
  }
  const inside = !((hay.edges[first] ?? 0) & FIRST) || !((hay.edges[end - 1] ?? 0) & LAST);
  return inside ? { start, end: stop, refused: "boundary" } : { start, end: stop };
}

/** The first folded unit whose original span starts at or after `from`. */
function firstUnitFrom(hay: Folded, from: number): number {
  let low = 0;
  let high = hay.start.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((hay.start[middle] ?? 0) < from) low = middle + 1;
    else high = middle;
  }
  return low;
}
