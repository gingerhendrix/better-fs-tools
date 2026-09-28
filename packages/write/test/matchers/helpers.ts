import type { MatchContext, Matcher, MatchRange } from "../../src/index.ts";

export const TEXT: MatchContext = { mode: "text", from: 0, maxMatches: 100 };
export const LINES: MatchContext = { mode: "lines", from: 0, maxMatches: 100 };

/** The matched text of each range, with the boundary flag when set. */
export function hits(
  matcher: Matcher,
  haystack: string,
  needle: string,
  ctx: MatchContext = TEXT,
): string[] {
  return matcher
    .find(haystack, needle, ctx)
    .map((range: MatchRange) =>
      range.refused === undefined
        ? haystack.slice(range.start, range.end)
        : `${haystack.slice(range.start, range.end)} (${range.refused})`,
    );
}
