import type { Matcher } from "../contract/matcher.ts";
import { findExact } from "./exact.ts";

const ESCAPED = /\\(?:u[0-9a-fA-F]{4}|[nt"\\])/u;
const ESCAPES = /\\(?:u([0-9a-fA-F]{4})|([nt"\\]))/gu;

/**
 * Matches old text that was escaped once too often, with `\n`, `\t`, `\"`,
 * `\\`, or `\uXXXX` written out. The new text is unescaped the same way.
 */
export function escapeMatcher(): Matcher {
  return Object.freeze<Matcher>({
    id: "escape",
    fuzzy: true,
    describe: 'escape sequences such as \\n, \\t, and \\" written out in the old text',
    find(haystack, needle, ctx) {
      if (!ESCAPED.test(needle)) return [];
      const plain = unescapeText(needle);
      return plain === needle ? [] : findExact(haystack, plain, ctx);
    },
    adapt: (newText) => unescapeText(newText),
  });
}

function unescapeText(text: string): string {
  return text.replace(ESCAPES, (_match, hex: string | undefined, char: string | undefined) => {
    if (hex !== undefined) return String.fromCharCode(Number.parseInt(hex, 16));
    if (char === "n") return "\n";
    if (char === "t") return "\t";
    return char ?? "";
  });
}
