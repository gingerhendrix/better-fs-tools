import type { Guard } from "../contract/extensions.ts";
import {
  ALLOW,
  existingLines,
  lineTester,
  linesOf,
  newTextParam,
  quoted,
  refuse,
} from "./shared.ts";

/**
 * The read formatters' gutters: `12|` (line-number, Hermes), `12:a3|`
 * (hashline, any digest alphabet), and `12: ` (OpenCode). Also `12→` and a
 * padded `     12` then a tab, the `cat -n` style other hosts show. The tab
 * form needs leading spaces, so tab-separated data with an id column does
 * not match. Group 1 or 3 holds the number. Group 2 is the `: ` separator,
 * the one weak form: YAML keys and dict literals look the same.
 */
const DEFAULT_GUTTER = /^[ \t]*(\d+)(?::[0-9A-Za-z_-]+)?(?:\||→|(: ))|^ +(\d+)\t/u;

interface GutterHit {
  readonly line: number;
  readonly number: number | null;
  readonly weak: boolean;
  readonly gutter: string;
}

/**
 * Refuses new text copied from read output with its line-number gutter
 * (Hermes, Claude Code, OpenCode). A fragment is refused when at least 2 of
 * its new non-empty lines, and at least `ratio` of them, start with a
 * gutter whose numbers run on by one, as read output does. Lines that are
 * already in the file do not count. With the default gutter, the weak
 * `12: ` form needs 3 such lines. A file whose before text already has
 * `ratio` of its lines in gutter form is not checked.
 */
export function readPrefixGuard(
  options: { readonly gutter?: RegExp; readonly ratio?: number } = {},
): Guard<unknown> {
  const { gutter = DEFAULT_GUTTER, ratio = 0.5 } = options;
  if (!(gutter instanceof RegExp)) throw new TypeError("gutter must be a regular expression");
  if (typeof ratio !== "number" || !(ratio > 0 && ratio <= 1)) {
    throw new TypeError("ratio must be a number above 0 and at most 1");
  }
  const test = lineTester(gutter);
  const builtIn = gutter === DEFAULT_GUTTER;
  return Object.freeze<Guard<unknown>>({
    id: "read-prefix",
    check(change, ctx) {
      if (change.after === null) return ALLOW;
      const known = existingLines(change);
      let beforeChecked = false;
      for (const fragment of change.fragments) {
        const lines = linesOf(fragment.newText).filter((line) => line.trim() !== "");
        const hits = runs(lines.flatMap((line, index) => hit(test, line, index)));
        if (hits.length < 2) continue;
        const fresh = lines.filter((line) => !known(line));
        const counted = hits.filter((entry) => !known(lines[entry.line] as string));
        if (counted.length < 2 || counted.length < ratio * fresh.length) continue;
        if (builtIn && counted.length < 3 && counted.every((entry) => entry.weak)) continue;
        if (!beforeChecked) {
          beforeChecked = true;
          if (change.before !== null && gutterShare(test, change.before.text) >= ratio) {
            return ALLOW;
          }
        }
        const sample = (counted[0] as GutterHit).gutter;
        return refuse(
          "read-prefix",
          `The ${newTextParam(change, ctx)} for ${change.displayPath} starts ${counted.length} of its ${fresh.length} new lines with read tool line numbers, such as "${quoted(sample)}". Send only the file text, without the line-number prefixes.`,
          { lines: counted.length, gutter: sample },
        );
      }
      return ALLOW;
    },
  });
}

function hit(test: RegExp, text: string, line: number): GutterHit[] {
  const match = test.exec(text);
  if (match === null) return [];
  const digits = match.slice(1).find((group) => group !== undefined && /^\d+$/u.test(group));
  return [
    {
      line,
      number: digits === undefined ? null : Number(digits),
      weak: match[2] !== undefined,
      gutter: match[0],
    },
  ];
}

/**
 * Hits whose numbers run on by one from a neighbouring hit. A gutter with
 * no number group keeps every hit.
 */
function runs(hits: readonly GutterHit[]): GutterHit[] {
  return hits.filter((entry, index) => {
    if (entry.number === null) return true;
    const before = hits[index - 1];
    const after = hits[index + 1];
    return (
      (before?.number !== undefined && before.number === entry.number - 1) ||
      (after?.number !== undefined && after.number === entry.number + 1)
    );
  });
}

/** The share of non-empty lines in `text` that start with the gutter. */
function gutterShare(test: RegExp, text: string): number {
  let lines = 0;
  let hits = 0;
  for (const line of linesOf(text)) {
    if (line.trim() === "") continue;
    lines += 1;
    if (test.test(line)) hits += 1;
  }
  return lines === 0 ? 0 : hits / lines;
}
