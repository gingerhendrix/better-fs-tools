import type { ReadHook } from "../contract/extensions.ts";
import type { ContentPart, ReadLine } from "../contract/result.ts";

const ENCODER = new TextEncoder();

export interface RedactOptions {
  /** Each pattern must have the "g" flag. */
  patterns: readonly RegExp[];
  /** Default "[REDACTED]". Inserted as is: "$" has no special meaning. */
  replacement?: string;
}

/**
 * Replaces matches in view line text and in text parts. A match must lie
 * inside one line, and a clamped line holds only its first
 * limits.maxCharsPerLine characters. When nothing matches, the outcome is
 * unchanged and gets no view-modified note.
 */
export function redact(options: RedactOptions): ReadHook<unknown> {
  const { patterns, replacement = "[REDACTED]" } = options ?? {};
  if (!Array.isArray(patterns)) throw new TypeError("redact patterns must be an array");
  for (const pattern of patterns) {
    if (!(pattern instanceof RegExp) || !pattern.flags.includes("g")) {
      throw new TypeError(`redact pattern ${String(pattern)} must be a RegExp with the "g" flag`);
    }
  }
  if (typeof replacement !== "string") throw new TypeError("redact replacement must be a string");
  const list: readonly RegExp[] = Object.freeze([...patterns]);
  const scrub = (text: string): string =>
    list.reduce((current, pattern) => current.replace(pattern, () => replacement), text);

  return Object.freeze<ReadHook<unknown>>({
    id: "redact",
    afterRead(outcome) {
      if (outcome.status === "ok") {
        const lines = outcome.view.lines.map((line): ReadLine => {
          const text = scrub(line.text);
          return text === line.text ? line : { ...line, text };
        });
        if (lines.every((line, index) => line === outcome.view.lines[index])) return outcome;
        return { ...outcome, view: { ...outcome.view, lines, bytes: viewBytes(lines) } };
      }
      if (outcome.status === "media") {
        const parts = outcome.parts.map((part): ContentPart => {
          if (part.type !== "text") return part;
          const text = scrub(part.text);
          return text === part.text ? part : { ...part, text };
        });
        if (parts.every((part, index) => part === outcome.parts[index])) return outcome;
        return { ...outcome, parts };
      }
      return outcome;
    },
  });
}

function viewBytes(lines: readonly ReadLine[]): number {
  let total = Math.max(0, lines.length - 1);
  for (const line of lines) total += ENCODER.encode(line.text).byteLength;
  return total;
}
