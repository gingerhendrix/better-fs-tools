import type { FormatContext } from "../contract/format.ts";
import type { ReadNote, ReadOutcome } from "../contract/result.ts";

export interface LayoutOptions {
  header?: (outcome: ReadOutcome, ctx: FormatContext<unknown>) => string | null;
  footer?: (outcome: ReadOutcome, ctx: FormatContext<unknown>) => string | null;
  /** Filter or rewrite a note for display. null hides it. */
  notes?: (note: ReadNote) => ReadNote | null;
  /** Default: `[read:${note.code}] ${note.message}`. */
  noteLine?: (note: ReadNote) => string;
}

export function defaultNoteLine(note: ReadNote): string {
  return `[read:${note.code}] ${note.message}`;
}

/**
 * Header, body, and footer, one per line, then a blank line and the note lines.
 * "view" mode returns the body only.
 */
export function layout(
  outcome: ReadOutcome,
  ctx: FormatContext<unknown>,
  body: string,
  options: LayoutOptions,
): string {
  if (ctx.mode === "view") return body;
  const header = options.header?.(outcome, ctx) ?? null;
  const footer = options.footer?.(outcome, ctx) ?? null;
  const main = [header, body, footer].filter((part) => part !== null && part !== "").join("\n");
  return join(main, noteLines(outcome.notes, options));
}

export function noteLines(notes: readonly ReadNote[], options: LayoutOptions): string[] {
  const filter = options.notes ?? ((note: ReadNote) => note);
  const line = options.noteLine ?? defaultNoteLine;
  const lines: string[] = [];
  for (const note of notes) {
    const shown = filter(note);
    if (shown !== null) lines.push(line(shown));
  }
  return lines;
}

export function join(main: string, lines: readonly string[]): string {
  const notes = lines.join("\n");
  if (main && notes) return `${main}\n\n${notes}`;
  return main || notes;
}
