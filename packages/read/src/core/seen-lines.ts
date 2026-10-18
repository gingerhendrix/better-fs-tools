import type { ReadLineRange } from "../contract/result.ts";

/** Sorts the ranges and joins ranges that overlap or touch. */
export function joinLineRanges(ranges: readonly ReadLineRange[]): ReadLineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const joined: ReadLineRange[] = [];
  for (const range of sorted) {
    const last = joined.at(-1);
    if (last !== undefined && range.start <= last.end + 1) {
      joined[joined.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      joined.push({ start: range.start, end: range.end });
    }
  }
  return joined;
}

/** True when joined ranges show every line from 1 to totalLines. */
export function coversLines(joined: readonly ReadLineRange[], totalLines: number): boolean {
  if (totalLines === 0) return true;
  const first = joined[0];
  return first !== undefined && first.start <= 1 && first.end >= totalLines;
}

/** Reads ranges from a stored record. Anything malformed counts as no range. */
export function storedLineRanges(value: unknown): ReadLineRange[] {
  if (!Array.isArray(value)) return [];
  const ranges: ReadLineRange[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") return [];
    const { start, end } = item as Record<string, unknown>;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return [];
    if ((start as number) < 1 || (end as number) < (start as number)) return [];
    ranges.push({ start: start as number, end: end as number });
  }
  return ranges;
}
