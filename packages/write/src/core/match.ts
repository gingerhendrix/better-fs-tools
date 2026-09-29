import type { Matcher, MatchContext, MatchRange } from "../contract/matcher.ts";
import { extensionId } from "./extension-error.ts";
import { isRecord } from "./input.ts";
import type { MutationScope } from "./scope.ts";

export const REPLACE_ALL_CAP = 100_000;

const DRIFT_ESCAPE_SEQUENCES = ["\\n", "\\t", '\\"', "\\'", "\\\\"] as const;

export function runChain<THost>(
  scope: MutationScope<THost>,
  matchers: readonly Matcher[],
  haystack: string,
  needle: string,
  ctx: MatchContext,
): { readonly matcher: Matcher; readonly ranges: readonly MatchRange[] } | null {
  for (const matcher of matchers) {
    scope.checkAbort();
    const ranges = findWith(scope, matcher, haystack, needle, ctx);
    if (ranges.length > 0) return { matcher, ranges };
  }
  return null;
}

export function findWith<THost>(
  scope: MutationScope<THost>,
  matcher: Matcher,
  haystack: string,
  needle: string,
  ctx: MatchContext,
): readonly MatchRange[] {
  let result: unknown;
  try {
    result = matcher.find(haystack, needle, Object.freeze({ ...ctx }));
  } catch (error) {
    throw scope.extensionFailure("matchers", extensionId(matcher, error));
  }
  if (!validRanges(result, haystack.length, ctx.from)) {
    throw scope.extensionFailure("matchers", extensionId(matcher));
  }
  return result.slice(0, ctx.maxMatches);
}

function validRanges(value: unknown, length: number, from: number): value is readonly MatchRange[] {
  if (!Array.isArray(value)) return false;
  let previous = from;
  for (const range of value) {
    if (!isRecord(range)) return false;
    const { start, end, refused } = range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false;
    const first = start as number;
    const last = end as number;
    if (first < previous || last <= first || last > length) return false;
    if (refused !== undefined && refused !== "boundary") return false;
    previous = last;
  }
  return true;
}

export function adaptFor<THost>(
  scope: MutationScope<THost>,
  matcher: Matcher,
  newText: string,
  hit: { readonly haystack: string; readonly needle: string; readonly range: MatchRange },
): string {
  if (matcher.adapt === undefined) return newText;
  let adapted: unknown;
  try {
    adapted = matcher.adapt(newText, hit);
  } catch (error) {
    throw scope.extensionFailure("matchers", extensionId(matcher, error));
  }
  if (typeof adapted !== "string") throw scope.extensionFailure("matchers", extensionId(matcher));
  return adapted;
}

export function tooWide(range: MatchRange, needle: string): boolean {
  return range.end - range.start > 2 * needle.length + 64;
}

export function escapeDrift(newText: string, region: string): boolean {
  return DRIFT_ESCAPE_SEQUENCES.some(
    (sequence) => newText.includes(sequence) && !region.includes(sequence),
  );
}
