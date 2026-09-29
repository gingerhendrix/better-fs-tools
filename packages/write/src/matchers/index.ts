import type { Matcher } from "../contract/matcher.ts";
import { escapeMatcher } from "./escape.ts";
import { exactMatcher } from "./exact.ts";
import { lineTrimmedMatcher } from "./line-trimmed.ts";
import { normalizedMatcher } from "./normalized.ts";

export { blockAnchorMatcher } from "./block-anchor.ts";
export { escapeMatcher } from "./escape.ts";
export { exactMatcher } from "./exact.ts";
export { indentationMatcher } from "./indentation.ts";
export { lineTrimmedMatcher } from "./line-trimmed.ts";
export { normalizedMatcher } from "./normalized.ts";

/** The matchers the edit tool tries by default, in order: exact, normalized, escape. */
export function defaultEditMatchers(): readonly Matcher[] {
  return Object.freeze([exactMatcher(), normalizedMatcher(), escapeMatcher()]);
}

/** The matchers the patch tool tries by default, in order: exact, normalized, line-trimmed. */
export function defaultPatchMatchers(): readonly Matcher[] {
  return Object.freeze([exactMatcher(), normalizedMatcher(), lineTrimmedMatcher()]);
}
