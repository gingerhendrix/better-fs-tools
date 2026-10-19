import type { ChangeFragment } from "../contract/extensions.ts";
import type { Matcher, MatchRange } from "../contract/matcher.ts";
import type { PatchHunk, PatchLine } from "../contract/patch.ts";
import type { MatchInfo } from "../contract/result.ts";
import { keepFileLines } from "../matchers/keep-bytes.ts";
import { findWith } from "./match.ts";
import type { MutationScope } from "./scope.ts";

export type HunkProblem =
  | { readonly reason: "context-not-found"; readonly hunk: number; readonly context: string }
  | {
      readonly reason: "lines-not-found";
      readonly hunk: number;
      readonly lines: readonly string[];
      /** Zero-based line where the search for the old lines started. */
      readonly from: number;
      /** Zero-based line that the `@@` text matched, or null for a bare `@@`. */
      readonly context: number | null;
    };

export type HunksOutcome =
  | {
      readonly ok: true;
      readonly text: string;
      readonly matches: readonly MatchInfo[];
      readonly changed: readonly (readonly [number, number])[];
      readonly fragments: readonly ChangeFragment[];
    }
  | { readonly ok: false; readonly problem: HunkProblem };

interface Replacement {
  readonly start: number;
  readonly remove: number;
  readonly lines: readonly string[];
}

interface Hit {
  readonly line: number;
  readonly matcher: Matcher;
}

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
    let context: number | null = null;
    if (hunk.context !== null) {
      const hit = file.seek(scope, matchers, [hunk.context], cursor, false);
      if (hit === null) {
        return {
          ok: false,
          problem: { reason: "context-not-found", hunk: index, context: hunk.context },
        };
      }
      context = hit.line;
      cursor = hit.line + 1;
    }
    const after = findOld(hunk, (old) => file.seek(scope, matchers, old, cursor, hunk.endOfFile));
    if (after.old.length === 0) {
      const insertAt = hunk.context === null ? file.lines.length : cursor;
      replacements.push({ start: insertAt, remove: 0, lines: after.body.map((line) => line.text) });
      continue;
    }
    // A hunk whose @@ text is its own first old line: the model named the
    // line it changes. Codex looks only below that line; this also tries
    // the line itself, and takes a hit only when it starts there.
    const anchor = context;
    const at =
      after.hit !== null || anchor === null
        ? null
        : findOld(hunk, (old) => file.seekAt(scope, matchers, old, anchor, hunk.endOfFile));
    const { body, old, hit } = at !== null && at.hit !== null ? at : after;
    if (hit === null) {
      return {
        ok: false,
        problem: { reason: "lines-not-found", hunk: index, lines: old, from: cursor, context },
      };
    }
    replacements.push({ start: hit.line, remove: old.length, lines: newLines(body, file, hit) });
    found.push({ index, hit, size: old.length });
    cursor = hit.line + old.length;
  }
  return applyReplacements(file, replacements, found);
}

function applyReplacements(
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

interface OldLines {
  readonly body: readonly PatchLine[];
  readonly old: readonly string[];
  readonly hit: Hit | null;
}

/**
 * Seeks the old lines of a hunk. When they are not found and the last old
 * line is empty, seeks again without it: it is often only a blank separator.
 */
function findOld(hunk: PatchHunk, seek: (old: readonly string[]) => Hit | null): OldLines {
  const old = oldLines(hunk.lines);
  const hit = old.length === 0 ? null : seek(old);
  if (hit !== null || old.length === 0 || old.at(-1) !== "") {
    return { body: hunk.lines, old, hit };
  }
  const body = withoutLastOldLine(hunk.lines);
  const shorter = oldLines(body);
  return { body, old: shorter, hit: shorter.length === 0 ? null : seek(shorter) };
}

function oldLines(body: readonly PatchLine[]): string[] {
  return body.filter((line) => line.kind !== "+").map((line) => line.text);
}

function withoutLastOldLine(body: readonly PatchLine[]): PatchLine[] {
  const last = body.findLastIndex((line) => line.kind !== "+");
  const copy = [...body];
  const line = copy[last] as PatchLine;
  const followed = copy.slice(last + 1).length > 0;
  if (line.kind === " " && followed) copy[last] = { kind: "+", text: line.text };
  else copy.splice(last, 1);
  return copy;
}

/**
 * Context lines keep the file's bytes. In each run of `-` and `+` lines, a
 * `-` line that comes back unchanged as a `+` line keeps them too, and each
 * other `+` line takes the CR of the file line it replaces. A hunk whose
 * old and new lines are the same exists only to change the characters the
 * matcher folded, so its `+` lines are written as given, with the file's CRs.
 */
function newLines(body: readonly PatchLine[], file: LineFile, hit: Hit): string[] {
  const keepUnchanged = !sameTexts(
    body.filter((line) => line.kind !== "+"),
    body.filter((line) => line.kind !== "-"),
  );
  const lines: string[] = [];
  let removedFile: string[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    lines.push(...keepFileLines(removedFile, removed, added, keepUnchanged));
    removedFile = [];
    removed = [];
    added = [];
  };
  let offset = 0;
  for (const line of body) {
    if (line.kind === "+") {
      added.push(line.text);
      continue;
    }
    const own = file.lines[hit.line + offset] as string;
    offset += 1;
    if (line.kind === "-") {
      removedFile.push(own);
      removed.push(line.text);
      continue;
    }
    flush();
    lines.push(own);
  }
  flush();
  return lines;
}

function sameTexts(old: readonly PatchLine[], next: readonly PatchLine[]): boolean {
  return old.length === next.length && old.every((line, at) => line.text === next[at]?.text);
}

class LineFile {
  readonly lines: string[];
  readonly finalNewline: boolean;
  private readonly haystack: string;
  private readonly lineStartOffsets: number[];

  constructor(text: string) {
    this.lines = text === "" ? [] : text.split("\n");
    if (text.endsWith("\n")) this.lines.pop();
    // An empty file takes a final newline once it has lines.
    this.finalNewline = text === "" || text.endsWith("\n");
    this.haystack = this.lines.map((line) => `${line}\n`).join("");
    this.lineStartOffsets = [];
    let offset = 0;
    for (const line of this.lines) {
      this.lineStartOffsets.push(offset);
      offset += line.length + 1;
    }
    this.lineStartOffsets.push(offset);
  }

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
          from: this.lineStartOffsets[at] as number,
          maxMatches: 1,
        });
        if (range === undefined) break;
        const line = this.lineAt(range.start);
        if (this.coversWholeLines(range, line, wanted.length) && (!endOfFile || line === last)) {
          return { line, matcher };
        }
        if (endOfFile) break;
        at = Math.max(at, line) + 1;
      }
    }
    return null;
  }

  /** Like seek(), but takes a hit only when it starts at `line`. */
  seekAt<THost>(
    scope: MutationScope<THost>,
    matchers: readonly Matcher[],
    wanted: readonly string[],
    line: number,
    endOfFile: boolean,
  ): Hit | null {
    const last = this.lines.length - wanted.length;
    if (line > last || (endOfFile && line !== last)) return null;
    const needle = wanted.map((text) => `${text}\n`).join("");
    for (const matcher of matchers) {
      scope.checkAbort();
      const [range] = findWith(scope, matcher, this.haystack, needle, {
        mode: "lines",
        from: this.lineStartOffsets[line] as number,
        maxMatches: 1,
      });
      if (range === undefined || this.lineAt(range.start) !== line) continue;
      if (this.coversWholeLines(range, line, wanted.length)) return { line, matcher };
    }
    return null;
  }

  private coversWholeLines(range: MatchRange, line: number, count: number): boolean {
    if (range.refused !== undefined) return false;
    return (
      this.lineStartOffsets[line] === range.start &&
      this.lineStartOffsets[line + count] === range.end
    );
  }

  private lineAt(offset: number): number {
    let low = 0;
    let high = this.lineStartOffsets.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if ((this.lineStartOffsets[middle] as number) <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  }
}
