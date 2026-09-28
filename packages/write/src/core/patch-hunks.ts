import type { ChangeFragment } from "../contract/extensions.ts";
import type { Matcher, MatchRange } from "../contract/matcher.ts";
import type { PatchHunk, PatchLine } from "../contract/patch.ts";
import type { MatchInfo } from "../contract/result.ts";
import { findWith } from "./match.ts";
import type { MutationScope } from "./scope.ts";

/** Why a hunk failed. `hunk` is zero-based. */
export type HunkProblem =
  | { readonly reason: "context-not-found"; readonly hunk: number; readonly context: string }
  | {
      readonly reason: "lines-not-found";
      readonly hunk: number;
      readonly lines: readonly string[];
    };

export type HunksOutcome =
  | {
      readonly ok: true;
      /** The new text, in the same text space as the input. */
      readonly text: string;
      /** One entry for each hunk that replaced lines. Pure insertions have none. */
      readonly matches: readonly MatchInfo[];
      /** One-based inclusive lines of each change in the new text, for snippets. */
      readonly changed: readonly (readonly [number, number])[];
      /** Removed and added lines of each hunk. */
      readonly fragments: readonly ChangeFragment[];
    }
  | { readonly ok: false; readonly problem: HunkProblem };

/** One hunk's change, in lines of the original file. */
interface Replacement {
  readonly start: number;
  readonly remove: number;
  readonly lines: readonly string[];
}

/** A hit of the old lines: the first line index and the matcher that found it. */
interface Hit {
  readonly line: number;
  readonly matcher: Matcher;
}

/**
 * Applies an Update's hunks to one file's decoded text (section 5.7 step 3).
 * Each hunk is searched at or after the cursor, which starts at line 0 and
 * moves past each hit (W9, the Codex rule: first match after the previous
 * hunk). The chain runs in line mode, and the first matcher with a hit
 * decides. A " " line takes the matched original line, so untouched bytes
 * stay. A "+" line is taken as given, and a "-" line is dropped. The file's
 * final-newline state is kept. Replacements are made with array splices,
 * never String.prototype.replace, so `$&` in a "+" line stays literal.
 */
export function applyHunks<THost>(
  scope: MutationScope<THost>,
  matchers: readonly Matcher[],
  text: string,
  hunks: readonly PatchHunk[],
): HunksOutcome {
  const file = new LineFile(text);
  const replacements: Replacement[] = [];
  const found: { readonly index: number; readonly hit: Hit; readonly size: number }[] = [];
  let cursor = 0;
  for (const [index, hunk] of hunks.entries()) {
    if (hunk.context !== null) {
      const hit = file.seek(scope, matchers, [hunk.context], cursor, false);
      if (hit === null) {
        return {
          ok: false,
          problem: { reason: "context-not-found", hunk: index, context: hunk.context },
        };
      }
      cursor = hit.line + 1;
    }
    let body = hunk.lines;
    let old = oldLines(body);
    let hit = old.length === 0 ? null : file.seek(scope, matchers, old, cursor, hunk.endOfFile);
    if (hit === null && old.length > 0 && old.at(-1) === "") {
      // A trailing empty old line is often a blank separator (Codex): retry without it.
      body = withoutLastOld(body);
      old = oldLines(body);
      hit = old.length === 0 ? null : file.seek(scope, matchers, old, cursor, hunk.endOfFile);
    }
    if (old.length === 0) {
      // D19: insert after the @@ context line, else at the end of the file.
      const start = hunk.context === null ? file.lines.length : cursor;
      replacements.push({ start, remove: 0, lines: body.map((line) => line.text) });
      continue;
    }
    if (hit === null) {
      return { ok: false, problem: { reason: "lines-not-found", hunk: index, lines: old } };
    }
    replacements.push({ start: hit.line, remove: old.length, lines: newLines(body, file, hit) });
    found.push({ index, hit, size: old.length });
    cursor = hit.line + old.length;
  }
  return finish(file, replacements, found);
}

/** Splices from the last replacement to the first and reports where each landed. */
function finish(
  file: LineFile,
  replacements: readonly Replacement[],
  found: readonly { readonly index: number; readonly hit: Hit; readonly size: number }[],
): HunksOutcome {
  const order = replacements
    .map((replacement, at) => ({ replacement, at }))
    .sort((a, b) => a.replacement.start - b.replacement.start || a.at - b.at);
  const result = [...file.lines];
  for (let at = order.length - 1; at >= 0; at -= 1) {
    const { start, remove, lines } = (order[at] as (typeof order)[number]).replacement;
    result.splice(start, remove, ...lines);
  }
  const placed = new Map<number, readonly [number, number]>();
  const changed: (readonly [number, number])[] = [];
  let shift = 0;
  for (const { replacement, at } of order) {
    const first = replacement.start + shift + 1;
    const span = [first, Math.max(first, first + replacement.lines.length - 1)] as const;
    placed.set(at, span);
    changed.push(span);
    shift += replacement.lines.length - replacement.remove;
  }
  const matches: MatchInfo[] = [];
  let hitAt = 0;
  for (const [at, replacement] of replacements.entries()) {
    if (replacement.remove === 0) continue;
    const { index, hit, size } = found[hitAt] as (typeof found)[number];
    hitAt += 1;
    matches.push({
      index,
      matcher: hit.matcher.id,
      fuzzy: hit.matcher.fuzzy,
      lines: [hit.line + 1, hit.line + size],
      count: 1,
      replaced: [placed.get(at) as readonly [number, number]],
    });
  }
  const fragments = replacements.map((replacement) => ({
    oldText: file.lines.slice(replacement.start, replacement.start + replacement.remove).join("\n"),
    newText: replacement.lines.join("\n"),
  }));
  const ending = file.finalNewline && result.length > 0 ? "\n" : "";
  return { ok: true, text: `${result.join("\n")}${ending}`, matches, changed, fragments };
}

function oldLines(body: readonly PatchLine[]): string[] {
  return body.filter((line) => line.kind !== "+").map((line) => line.text);
}

/**
 * The body without its last old line (Codex): a "-" line goes. A " " line
 * goes from the old lines, and stays as an added empty line only when "+"
 * lines follow it, so the new lines lose a trailing empty line as Codex's do.
 */
function withoutLastOld(body: readonly PatchLine[]): PatchLine[] {
  const last = body.findLastIndex((line) => line.kind !== "+");
  const copy = [...body];
  const line = copy[last] as PatchLine;
  const followed = copy.slice(last + 1).length > 0;
  if (line.kind === " " && followed) copy[last] = { kind: "+", text: line.text };
  else copy.splice(last, 1);
  return copy;
}

/** The new lines for a hit: " " takes the original line, "+" is as given, "-" is dropped. */
function newLines(body: readonly PatchLine[], file: LineFile, hit: Hit): string[] {
  const lines: string[] = [];
  let offset = 0;
  for (const line of body) {
    if (line.kind === "+") {
      lines.push(line.text);
      continue;
    }
    if (line.kind === " ") lines.push(file.lines[hit.line + offset] as string);
    offset += 1;
  }
  return lines;
}

/**
 * A file as lines, and the haystack the matchers search: every line with a
 * "\n", so each hit covers whole lines with their breaks, including the
 * last line of a file without a final newline.
 */
class LineFile {
  readonly lines: string[];
  readonly finalNewline: boolean;
  private readonly haystack: string;
  /** Offset of each line in the haystack, plus the haystack length. */
  private readonly starts: number[];

  constructor(text: string) {
    this.lines = text === "" ? [] : text.split("\n");
    if (text.endsWith("\n")) this.lines.pop();
    // An empty file takes a final newline once it has lines.
    this.finalNewline = text === "" || text.endsWith("\n");
    this.haystack = this.lines.map((line) => `${line}\n`).join("");
    this.starts = [];
    let offset = 0;
    for (const line of this.lines) {
      this.starts.push(offset);
      offset += line.length + 1;
    }
    this.starts.push(offset);
  }

  /**
   * The first line index at or after `from` where the chain matches `wanted`
   * as whole lines. With `endOfFile`, the only candidate is the block that
   * ends at the last line. The first matcher with a usable hit decides.
   */
  seek<THost>(
    scope: MutationScope<THost>,
    matchers: readonly Matcher[],
    wanted: readonly string[],
    from: number,
    endOfFile: boolean,
  ): Hit | null {
    const needle = wanted.map((line) => `${line}\n`).join("");
    const last = this.lines.length - wanted.length;
    const first = endOfFile ? last : from;
    if (first < from || first > last) return null;
    for (const matcher of matchers) {
      scope.checkAbort();
      let at = first;
      while (at <= last) {
        const [range] = findWith(scope, matcher, this.haystack, needle, {
          mode: "lines",
          from: this.starts[at] as number,
          maxMatches: 1,
        });
        if (range === undefined) break;
        const line = this.lineAt(range.start);
        if (this.usable(range, line, wanted.length) && (!endOfFile || line === last)) {
          return { line, matcher };
        }
        if (endOfFile) break;
        // A hit that is not whole lines of the right count is skipped, not used.
        at = Math.max(at, line) + 1;
      }
    }
    return null;
  }

  /** true when the range starts at line `line` and covers exactly `count` whole lines. */
  private usable(range: MatchRange, line: number, count: number): boolean {
    if (range.refused !== undefined) return false;
    return this.starts[line] === range.start && this.starts[line + count] === range.end;
  }

  /** The line that holds the haystack offset. */
  private lineAt(offset: number): number {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if ((this.starts[middle] as number) <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }
}
