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

// Notes and truncation markers that read tools add around file text.
const DEFAULT_PATTERNS: readonly RegExp[] = [
  /^\[read:(?:continue|line-clamped|scan-limit)\] /u,
  /… \[line truncated at \d+ chars\]$/u,
  /\.\.\. \[truncated\]$/u,
  /^\(End of file - total \d+ lines\)$/u,
  /^@@ (?:lines \d+-\d+|no lines)(?: of \d+)?(?: \| next offset \d+)? @@$/u,
];

/**
 * Refuses new text that holds a read tool note or truncation marker. A line
 * that is already in the file is allowed.
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
