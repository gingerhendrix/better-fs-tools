import type { Matcher, MatchContext, MatchRange } from "../contract/matcher.ts";
import { extensionId } from "./extension-error.ts";
import { isRecord } from "./input.ts";
import type { MutationScope } from "./scope.ts";

/** The most hits one replaceAll pair may have. More gives MATCH_REFUSED ("too-many"). */
export const REPLACE_ALL_CAP = 100_000;

/** Escape sequences a fuzzy hit's new text may not add (Hermes escape drift). */
const DRIFT = ["\\n", "\\t", '\\"', "\\'", "\\\\"] as const;

/** The first matcher in the chain that returns at least one range decides. null when none does. */
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

/**
 * One matcher's ranges, checked: a throw or a malformed result gives
 * EXTENSION_FAILED. Ranges must be integer offsets inside the haystack, at
 * or after `from`, non-empty, in order, and not overlapping. At most
 * `maxMatches` are kept.
 */
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

/** The matcher's new text for one hit. A throw or a non-string gives EXTENSION_FAILED. */
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

/** Span guard (OpenCode): a fuzzy range much longer than the needle. */
export function tooWide(range: MatchRange, needle: string): boolean {
  return range.end - range.start > 2 * needle.length + 64;
}

/** Escape drift (Hermes): the new text holds an escape sequence the matched region does not. */
export function escapeDrift(newText: string, region: string): boolean {
  return DRIFT.some((sequence) => newText.includes(sequence) && !region.includes(sequence));
}
