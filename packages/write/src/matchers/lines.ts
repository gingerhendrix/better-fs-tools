import type { MatchContext } from "../contract/matcher.ts";

const LF = 10;

/** true when `index` is at the start of a line. */
export function atLineStart(text: string, index: number): boolean {
  return index === 0 || text.charCodeAt(index - 1) === LF;
}

/** true when `end` closes a line: before its "\n", right after it, or at the end of the text. */
export function atLineEnd(text: string, end: number): boolean {
  return end === text.length || text.charCodeAt(end) === LF || text.charCodeAt(end - 1) === LF;
}

/** In "lines" mode a range must start at a line start and end at a line end. */
export function fitsMode(text: string, start: number, end: number, ctx: MatchContext): boolean {
  return ctx.mode === "text" || (atLineStart(text, start) && atLineEnd(text, end));
}

/**
 * The lines of a text with their offsets. A final "\n" ends the last line;
 * it does not start an empty one. `end` is the index of the line's "\n", or
 * the text length for a last line without one.
 */
export class LineTable {
  readonly starts: number[] = [];
  readonly ends: number[] = [];
  private trimmedLines: string[] | null = null;

  constructor(readonly text: string) {
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf("\n", start);
      const end = newline === -1 ? text.length : newline;
      this.starts.push(start);
      this.ends.push(end);
      start = end + 1;
    }
  }

  get count(): number {
    return this.starts.length;
  }

  line(index: number): string {
    return this.text.slice(this.starts[index] ?? 0, this.ends[index] ?? 0);
  }

  /** Each line with both ends trimmed. Built once. */
  get trimmed(): readonly string[] {
    this.trimmedLines ??= this.starts.map((_, index) => this.line(index).trim());
    return this.trimmedLines;
  }

  /** The first line that starts at or after `from`. */
  firstFrom(from: number): number {
    let low = 0;
    let high = this.starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((this.starts[middle] ?? 0) < from) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /**
   * The range that covers lines first..last. With `withBreak` it also takes
   * the "\n" after the last line, and is null when that line has none.
   */
  range(first: number, last: number, withBreak: boolean): { start: number; end: number } | null {
    const start = this.starts[first] ?? 0;
    const end = this.ends[last] ?? 0;
    if (!withBreak) return { start, end };
    return end < this.text.length ? { start, end: end + 1 } : null;
  }
}

/** A needle split into lines. A final "\n" sets `withBreak` instead of adding an empty line. */
export function needleLines(needle: string): { lines: string[]; withBreak: boolean } {
  const lines = needle.split("\n");
  const withBreak = lines.length > 1 && lines.at(-1) === "";
  if (withBreak) lines.pop();
  return { lines, withBreak };
}

/** One cached value for the last haystack a matcher saw. Edit pairs share one snapshot. */
export function lastValue<T>(build: (text: string) => T): (text: string) => T {
  let key: string | null = null;
  let value: T | null = null;
  return (text) => {
    if (key !== text || value === null) {
      value = build(text);
      key = text;
    }
    return value;
  };
}
