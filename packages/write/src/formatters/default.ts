import type { Note } from "@better-fs-tools/read";

import type { WriteToolName } from "../contract/context.ts";
import type { WriteFormatter } from "../contract/format.ts";
import type { FileChange, MutationReport, Snippet } from "../contract/result.ts";

export interface WriteFormatterOptions {
  /** Add the numbered lines around each edit to the model text. Default false. */
  readonly snippet?: boolean;
  /** Line-number prefix for edit snippets. Default: `${line}|`, as the read tool shows. */
  readonly gutter?: (line: number) => string;
  /** Add each change's diff to the model text. Default false. */
  readonly diff?: boolean;
  /** Filter or rewrite a note for the model text. null hides it. Default: show every note. */
  readonly notes?: (note: Note, tool: WriteToolName) => Note | null;
  /** Default: `[${tool}:${note.code}] ${note.message}`. */
  readonly noteLine?: (note: Note, tool: WriteToolName) => string;
}

/**
 * Formats a result as a line for each file, then the notes. An error shows the
 * notes only. "view" mode leaves the notes out. `snippet` adds the lines
 * around each edit, and `diff` adds each diff. The `notes` option hides or
 * rewrites a note, as the read tool's formatters do.
 */
export function defaultWriteFormatter(
  options: WriteFormatterOptions = {},
): WriteFormatter<unknown> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("defaultWriteFormatter options must be an object");
  }
  const {
    snippet = false,
    gutter = defaultGutter,
    diff = false,
    notes: filter = showNote,
    noteLine = defaultNoteLine,
  } = options;
  if (typeof gutter !== "function") {
    throw new TypeError("gutter must be a function");
  }
  if (typeof snippet !== "boolean") throw new TypeError("snippet must be a boolean");
  if (typeof diff !== "boolean") throw new TypeError("diff must be a boolean");
  if (typeof filter !== "function") throw new TypeError("notes must be a function");
  if (typeof noteLine !== "function") throw new TypeError("noteLine must be a function");
  return Object.freeze<WriteFormatter<unknown>>({
    id: "default",
    format(report, ctx) {
      const main = [
        ...body(report, snippet ? gutter : null, ctx.limits.maxListedMatches),
        ...(diff ? diffBlocks(report.changes) : []),
      ];
      if (ctx.mode === "view") return main.join("\n");
      const notes = noteLines(report.notes, report.tool, filter, noteLine);
      if (notes.length === 0) return main.join("\n");
      if (main.length === 0) return notes.join("\n");
      return `${main.join("\n")}\n\n${notes.join("\n")}`;
    },
  });
}

function noteLines(
  notes: readonly Note[],
  tool: WriteToolName,
  filter: (note: Note, tool: WriteToolName) => Note | null,
  line: (note: Note, tool: WriteToolName) => string,
): string[] {
  const lines: string[] = [];
  for (const note of notes) {
    const shown = filter(note, tool);
    if (shown !== null) lines.push(line(shown, tool));
  }
  return lines;
}

function showNote(note: Note): Note {
  return note;
}

function defaultNoteLine(note: Note, tool: WriteToolName): string {
  return `[${tool}:${note.code}] ${note.message}`;
}

function defaultGutter(line: number): string {
  return `${line}|`;
}

function body(
  report: MutationReport,
  gutter: ((line: number) => string) | null,
  listed: number,
): string[] {
  if (report.status === "error") return [];
  if (report.status === "no-change") {
    const reason = report.tool === "write" ? ": the content is the same" : "";
    return report.unchanged.map((path) => `No change to ${path}${reason}.`);
  }
  if (report.tool === "edit") {
    return report.changes.flatMap((change) => [
      editLine(change, listed),
      ...(gutter === null ? [] : snippetLines(change.snippets, gutter)),
    ]);
  }
  if (report.tool === "apply_patch") {
    return ["Success. Updated the following files:", ...report.changes.map(patchLine)];
  }
  return report.changes.map(changeLine);
}

// Follows the Codex apply_patch output: `A`, `M`, or `D` and the path.
function patchLine(change: FileChange): string {
  const letter = change.kind === "create" ? "A" : change.kind === "delete" ? "D" : "M";
  const details = [
    ...(change.movedFrom === null ? [] : [`moved from ${change.movedFrom}`]),
    ...change.matches
      .filter((match) => match.fuzzy)
      .map((match) => `hunk ${match.index + 1} matched by ${match.matcher}`),
  ];
  return `${letter} ${change.path}${details.length === 0 ? "" : ` (${details.join(", ")})`}`;
}

function editLine(change: FileChange, listed: number): string {
  if (change.userModified) {
    return `Edited ${change.path} with the user's changes (+${change.linesAdded} -${change.linesRemoved} lines).`;
  }
  const total = change.matches.reduce((sum, match) => sum + match.count, 0);
  const all = change.matches.some((match) => match.count > 1);
  const ranges = change.matches.flatMap((match) => match.replaced).sort((a, b) => a[0] - b[0]);
  const shown = ranges
    .slice(0, listed)
    .map(([first, last]) => (first === last ? `${first}` : `${first}-${last}`));
  const single = total === 1 && ranges.length === 1 && ranges[0]?.[0] === ranges[0]?.[1];
  const more = total > shown.length ? ", …" : "";
  const counted = `${total} replacement${total === 1 ? "" : "s"}${all ? " (replace all)" : ""}`;
  return `Edited ${change.path}: ${counted} at line${single ? "" : "s"} ${shown.join(", ")}${more}.`;
}

function snippetLines(snippets: readonly Snippet[], gutter: (line: number) => string): string[] {
  return snippets.flatMap((snippet, index) => [
    ...(index === 0 ? [] : ["..."]),
    ...snippet.lines.map((line, offset) => `${gutter(snippet.startLine + offset)}${line}`),
  ]);
}

function changeLine(change: FileChange): string {
  const counts = `(+${change.linesAdded} -${change.linesRemoved} lines)`;
  switch (change.kind) {
    case "create": {
      const lines = change.linesAdded;
      return `Created ${change.path} (${lines} line${lines === 1 ? "" : "s"}).`;
    }
    case "update":
      return `Updated ${change.path} ${counts}.`;
    case "delete":
      return `Deleted ${change.path}.`;
    default:
      return `Moved ${change.movedFrom ?? "a file"} to ${change.path} ${counts}.`;
  }
}

function diffBlocks(changes: readonly FileChange[]): string[] {
  const blocks: string[] = [];
  for (const change of changes) {
    if (change.diff === "") continue;
    const text = change.diff.endsWith("\n") ? change.diff.slice(0, -1) : change.diff;
    const fence = "`".repeat(Math.max(3, longestRun(text) + 1));
    blocks.push(`${fence}diff`, text, ...(change.diffTruncated ? ["…"] : []), fence);
  }
  return blocks;
}

function longestRun(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  return longest;
}
