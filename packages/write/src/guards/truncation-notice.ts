import type { Guard } from "../contract/extensions.ts";
import {
  ALLOW,
  existingLines,
  linesOf,
  newTextParam,
  quoted,
  refuse,
  regExpList,
} from "./shared.ts";

/**
 * Lines the read tool adds around file text, never file text itself: the
 * continuation and clamp note lines, the line-number formatter's clamp
 * marker, the Hermes clamp marker, the end-of-file footer, and the Deep
 * Agents range line.
 */
const DEFAULT_PATTERNS: readonly RegExp[] = [
  /^\[read:(?:continue|line-clamped|scan-limit)\] /u,
  /… \[line truncated at \d+ chars\]$/u,
  /\.\.\. \[truncated\]$/u,
  /^\(End of file - total \d+ lines\)$/u,
  /^@@ (?:lines \d+-\d+|no lines)(?: of \d+)?(?: \| next offset \d+)? @@$/u,
];

/**
 * Refuses new text that holds a read note line or a clamp marker (Oh My
 * Pi). Each pattern is tested on each new line. A line that is already in
 * the file is allowed, so a document that quotes read output can be
 * rewritten.
 */
export function truncationNoticeGuard(
  options: { readonly patterns?: readonly RegExp[] } = {},
): Guard<unknown> {
  const patterns =
    options.patterns === undefined ? DEFAULT_PATTERNS : regExpList(options.patterns, "patterns");
  return Object.freeze<Guard<unknown>>({
    id: "truncation-notice",
    check(change, ctx) {
      if (change.after === null) return ALLOW;
      const known = existingLines(change);
      for (const fragment of change.fragments) {
        for (const line of linesOf(fragment.newText)) {
          if (!patterns.some((pattern) => pattern.test(line)) || known(line)) continue;
          return refuse(
            "truncation-notice",
            `The ${newTextParam(change, ctx)} for ${change.displayPath} holds read tool output, not file text: "${quoted(line)}". Remove that line. If the file was cut off, read the missing lines first, then send the full text.`,
            { line: quoted(line) },
          );
        }
      }
      return ALLOW;
    },
  });
}
