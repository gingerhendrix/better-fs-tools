import type { Matcher } from "../contract/matcher.ts";
import { defaultEditMatchers } from "../matchers/index.ts";

/** The matcher chain a signature describes. Default defaultEditMatchers(). */
export function checkMatchers(matchers: unknown): readonly Matcher[] {
  if (matchers === undefined) return defaultEditMatchers();
  if (!Array.isArray(matchers) || matchers.length === 0) {
    throw new TypeError("matchers must be a non-empty array");
  }
  for (const matcher of matchers) {
    if (
      matcher === null ||
      typeof matcher !== "object" ||
      typeof matcher.describe !== "string" ||
      typeof matcher.fuzzy !== "boolean"
    ) {
      throw new TypeError("each matcher needs a describe string and a fuzzy flag");
    }
  }
  return matchers as readonly Matcher[];
}

/**
 * One sentence about how `old` is matched, built from the chain the tool runs.
 * An exact-only chain says so. Otherwise it lists what the fuzzy matchers fold,
 * in chain order.
 */
export function matchingSentence(matchers: readonly Matcher[], old: string): string {
  const folds = [...new Set(matchers.filter((m) => m.fuzzy).map((m) => m.describe))];
  if (folds.length === 0) {
    return `\`${old}\` must match the file exactly, including whitespace and indentation.`;
  }
  return (
    `\`${old}\` should match the file exactly. When it does not, a close match is used, ` +
    `and the result says so. A close match may differ in: ${folds.join("; ")}.`
  );
}
