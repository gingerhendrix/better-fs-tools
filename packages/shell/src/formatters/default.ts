import type { Note } from "@better-fs-tools/read";

import type { ShellFormatter } from "../contract/format.ts";
import type { ShellMessageCatalog } from "../contract/messages.ts";
import type { ShellOutput, ShellReport, ShellRun } from "../contract/result.ts";

export interface ShellFormatterOptions {
  /** Filter or rewrite a note for the model text. null hides it. Default: show every note. */
  readonly notes?: (note: Note) => Note | null;
  /** Default: `[bash:${note.code}] ${note.message}`. */
  readonly noteLine?: (note: Note) => string;
}

/**
 * The status line, then the output view, then a blank line and the note
 * lines. A call that did not run prints the note lines only. "view" mode
 * leaves out the notes. The `notes` option hides or rewrites a note, as the
 * read tool's formatters do.
 *
 * ```text
 * Exit code 1 · 0.4 s
 * <output>
 * ```
 */
export function defaultShellFormatter(
  options: ShellFormatterOptions = {},
): ShellFormatter<unknown> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("defaultShellFormatter options must be an object");
  }
  const { notes: filter = showNote, noteLine = defaultNoteLine } = options;
  if (typeof filter !== "function") throw new TypeError("notes must be a function");
  if (typeof noteLine !== "function") throw new TypeError("noteLine must be a function");
  return Object.freeze<ShellFormatter<unknown>>({
    id: "default",
    format(report, ctx) {
      const main = body(report, ctx.messages);
      if (ctx.mode === "view") return main.join("\n");
      const notes = noteLines(report.notes, filter, noteLine);
      if (notes.length === 0) return main.join("\n");
      if (main.length === 0) return notes.join("\n");
      return `${main.join("\n")}\n\n${notes.join("\n")}`;
    },
  });
}

function noteLines(
  notes: readonly Note[],
  filter: (note: Note) => Note | null,
  line: (note: Note) => string,
): string[] {
  const lines: string[] = [];
  for (const note of notes) {
    const shown = filter(note);
    if (shown !== null) lines.push(line(shown));
  }
  return lines;
}

function showNote(note: Note): Note {
  return note;
}

function defaultNoteLine(note: Note): string {
  return `[bash:${note.code}] ${note.message}`;
}

function body(report: ShellReport, messages: Readonly<ShellMessageCatalog>): string[] {
  const { run, output } = report;
  if (run === null) return [];
  return [statusLine(run, messages), ...outputLines(output, messages)];
}

function statusLine(run: ShellRun, messages: Readonly<ShellMessageCatalog>): string {
  if (run.stoppedBy === "timeout") return messages.timedOut({ timeoutMs: run.timeoutMs });
  return messages.exited({ code: run.exitCode, signal: run.signal, durationMs: run.durationMs });
}

function outputLines(
  output: ShellOutput | null,
  messages: Readonly<ShellMessageCatalog>,
): string[] {
  if (output === null || (output.head === "" && output.tail === null)) return [messages.noOutput()];
  if (output.tail === null) return [output.head];
  const gap = messages.omitted({
    lines: output.omittedLines,
    bytes: output.omittedBytes,
    spill: output.spill,
  });
  return [
    ...(output.head === "" ? [] : [output.head]),
    gap,
    ...(output.tail === "" ? [] : [output.tail]),
  ];
}
