import type { ChangeFragment, Guard, GuardContext, PlannedChange } from "../contract/extensions.ts";
import { ALLOW, linesOf, newTextParam, quoted, refuse, regExpList } from "./shared.ts";

const OPEN = String.raw`(?:\/\/+|#+|\/\*+|\{\s*\/\*+|\*|<!--|--|;+|%+)`;
const WORD = String.raw`(?:rest|remaining|existing|unchanged|unmodified|previous|same|omitted|original|other|code)`;

/**
 * Placeholder comment lines (Gemini CLI). The comment's text, without its
 * open and close marks, starts with an ellipsis and holds a placeholder
 * word, starts with a placeholder word and ends with an ellipsis, or is a
 * phrase such as "rest of the file unchanged". A bare `...`
 * line is not a placeholder: it is a Python stub.
 */
const DEFAULT_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`^\s*${OPEN}\s*[([]?\s*(?:\.{3}|…)\s*.{0,60}\b${WORD}\b.{0,60}$`, "iu"),
  new RegExp(
    String.raw`^\s*${OPEN}\s*[([]?\s*(?:the\s+)?${WORD}\b.{0,60}(?:\.{3}|…)\s*[)\]]?\s*(?:\*\/\}?|-->)?\s*$`,
    "iu",
  ),
  new RegExp(
    String.raw`^\s*${OPEN}\s*[([]?\s*(?:the\s+)?(?:rest\s+of\s+(?:the\s+)?\w+|(?:existing|remaining|previous|original|other)\s+\w+(?:\s+\w+)?)\s+(?:(?:is|are|remains?|stays?)\s+)?(?:unchanged|omitted|(?:the\s+)?same|as\s+before)\.?\s*[)\]]?\s*(?:\*\/\}?|-->)?\s*$`,
    "iu",
  ),
];

/**
 * Refuses a fragment that trades real lines for a placeholder comment such
 * as `// ... rest of code` (Gemini CLI). Only when the fragment's new text
 * is shorter than its old text, and only for a placeholder line that is not
 * in the old text.
 */
export function omissionGuard(
  options: { readonly patterns?: readonly RegExp[] } = {},
): Guard<unknown> {
  const patterns =
    options.patterns === undefined ? DEFAULT_PATTERNS : regExpList(options.patterns, "patterns");
  return Object.freeze<Guard<unknown>>({
    id: "omission",
    check(change, ctx) {
      for (const fragment of change.fragments) {
        if (fragment.newText.length >= fragment.oldText.length) continue;
        const placeholder = findPlaceholder(fragment, patterns);
        if (placeholder !== null) return refusal(change, ctx, placeholder);
      }
      return ALLOW;
    },
  });
}

function findPlaceholder(fragment: ChangeFragment, patterns: readonly RegExp[]): string | null {
  let old: Set<string> | null = null;
  for (const line of linesOf(fragment.newText)) {
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    old ??= new Set(linesOf(fragment.oldText).map((entry) => entry.trim()));
    if (!old.has(line.trim())) return line;
  }
  return null;
}

function refusal(change: PlannedChange, ctx: GuardContext<unknown>, line: string) {
  const param = newTextParam(change, ctx);
  const next =
    change.tool === "write"
      ? "Send the complete file content, or use the edit tool to change only part of the file."
      : `Write those lines out in full, or make the ${change.tool === "edit" ? ctx.messages.param("oldText") : "hunk"} smaller so they stay unchanged.`;
  return refuse(
    "omission",
    `The ${param} for ${change.displayPath} has a placeholder instead of code: "${quoted(line)}". It would delete the lines it stands for. ${next}`,
    { line: quoted(line) },
  );
}
