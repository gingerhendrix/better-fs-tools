import type { Note } from "@better-fs-tools/read";

import type { ShellFormatter } from "../contract/format.ts";
import type { ShellMessageCatalog } from "../contract/messages.ts";
import type { ShellOutput, ShellReport, ShellRun } from "../contract/result.ts";

export interface ShellFormatterOptions {
  /** Default: `[bash:${note.code}] ${note.message}`. */
  readonly noteLine?: (note: Note) => string;
}

/**
 * The status line, then the output view, then a blank line and the note
 * lines. A call that did not run prints the note lines only. "view" mode
 * leaves out the notes.
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
  const { noteLine = defaultNoteLine } = options;
  if (typeof noteLine !== "function") throw new TypeError("noteLine must be a function");
  return Object.freeze<ShellFormatter<unknown>>({
    id: "default",
    format(report, ctx) {
      const main = body(report, ctx.messages);
      if (ctx.mode === "view") return main.join("\n");
      const notes = report.notes.map(noteLine);
      if (notes.length === 0) return main.join("\n");
      if (main.length === 0) return notes.join("\n");
      return `${main.join("\n")}\n\n${notes.join("\n")}`;
    },
  });
}

function defaultNoteLine(note: Note): string {
  return `[bash:${note.code}] ${note.message}`;
}

function body(report: ShellReport, messages: Readonly<ShellMessageCatalog>): string[] {
  const { run, output } = report;
  if (run === null) return [];
  return [statusLine(run, messages), ...outputLines(output, messages)];
}

/** An abort or the capture cap shows the exit here, and its reason in the error note. */
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
