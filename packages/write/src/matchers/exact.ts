import type { Matcher, MatchContext, MatchRange } from "../contract/matcher.ts";
import { fitsMode } from "./lines.ts";

/** Matches the old text exactly. */
export function exactMatcher(): Matcher {
  return Object.freeze<Matcher>({
    id: "exact",
    fuzzy: false,
    describe: "nothing: the text must match exactly",
    find: findExact,
  });
}

export function findExact(haystack: string, needle: string, ctx: MatchContext): MatchRange[] {
  const ranges: MatchRange[] = [];
  if (needle === "") return ranges;
  let from = Math.max(0, ctx.from);
  while (ranges.length < ctx.maxMatches) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) break;
    const end = start + needle.length;
    if (!fitsMode(haystack, start, end, ctx)) {
      from = start + 1;
      continue;
    }
    ranges.push({ start, end });
    from = end;
  }
  return ranges;
}
