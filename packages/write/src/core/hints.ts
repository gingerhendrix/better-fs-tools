import { findExact } from "../matchers/exact.ts";
import { LineIndex } from "./line-index.ts";

const MAX_CLOSEST_REGION_COMPARISONS = 2_000_000;
const MAX_HINT_LINE_LENGTH = 200;
const MAX_TRACKED_PATHS = 256;

export function trailingNewline(text: string, oldText: string): "extra" | null {
  if (!oldText.endsWith("\n") || text.endsWith("\n")) return null;
  const trimmed = oldText.slice(0, -1);
  return trimmed !== "" && text.endsWith(trimmed) ? "extra" : null;
}

export function closestRegion(
  text: string,
  oldText: string,
  maxLines: number,
): { readonly text: string; readonly lines: readonly [number, number] } | null {
  const index = new LineIndex(text);
  const total = index.count;
  const needle = oldText.split("\n").map((line) => line.trim());
  if (needle.at(-1) === "" && needle.length > 1) needle.pop();
  const size = needle.length;
  if (total === 0 || total * size > MAX_CLOSEST_REGION_COMPARISONS) return null;
  const lines = Array.from({ length: total }, (_, offset) => index.line(offset + 1).trim());
  let best = 0;
  let bestLine = 0;
  for (let first = 0; first + Math.min(size, total) <= total; first += 1) {
    let score = 0;
    for (let offset = 0; offset < size && first + offset < total; offset += 1) {
      const wanted = needle[offset] as string;
      if (wanted !== "" && lines[first + offset] === wanted) score += 1;
    }
    if (score > best) {
      best = score;
      bestLine = first + 1;
    }
  }
  if (best === 0) return null;
  const from = Math.max(1, bestLine - 1);
  const to = Math.min(total, bestLine + size, from + maxLines - 1);
  const shown: string[] = [];
  for (let line = from; line <= to; line += 1) {
    const content = index.line(line);
    shown.push(
      `${line}|${content.length > MAX_HINT_LINE_LENGTH ? `${content.slice(0, MAX_HINT_LINE_LENGTH)}…` : content}`,
    );
  }
  return { text: shown.join("\n"), lines: [from, to] };
}

export function isAlreadyApplied(text: string, newText: string): boolean {
  return (
    newText !== "" &&
    findExact(text, newText, { mode: "text", from: 0, maxMatches: 2 }).length === 1
  );
}

export class MissCounter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly max = MAX_TRACKED_PATHS) {}

  miss(key: string): number {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.delete(key);
    this.counts.set(key, count);
    while (this.counts.size > this.max) {
      const oldest = this.counts.keys().next().value;
      if (oldest === undefined) break;
      this.counts.delete(oldest);
    }
    return count;
  }

  reset(key: string): void {
    this.counts.delete(key);
  }

  get size(): number {
    return this.counts.size;
  }
}
