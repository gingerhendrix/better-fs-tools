import type { ReadFormatContext } from "../contract/format.ts";
import type { ContentPart, ReadNote, ReadReport } from "../contract/result.ts";

export interface LayoutOptions {
  header?: (outcome: ReadReport, ctx: ReadFormatContext<unknown>) => string | null;
  footer?: (outcome: ReadReport, ctx: ReadFormatContext<unknown>) => string | null;
  /** Filter or rewrite a note for display. null hides it. */
  notes?: (note: ReadNote) => ReadNote | null;
  /** Default: `[read:${note.code}] ${note.message}`. */
  noteLine?: (note: ReadNote) => string;
}

export function defaultNoteLine(note: ReadNote): string {
  return `[read:${note.code}] ${note.message}`;
}

export function layout(
  outcome: ReadReport,
  ctx: ReadFormatContext<unknown>,
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

export function withParts(outcome: ReadReport, text: string): string | readonly ContentPart[] {
  if (outcome.status !== "media") return text;
  return text === "" ? [...outcome.parts] : [{ type: "text", text }, ...outcome.parts];
}
