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

/** W7: exact, then normalized, then escape. */
export function defaultEditMatchers(): readonly Matcher[] {
  return Object.freeze([exactMatcher(), normalizedMatcher(), escapeMatcher()]);
}

/** Codex seek_sequence order for patch hunks, used in "lines" mode: exact, normalized, line-trimmed. */
export function defaultPatchMatchers(): readonly Matcher[] {
  return Object.freeze([exactMatcher(), normalizedMatcher(), lineTrimmedMatcher()]);
}
