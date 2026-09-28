import type { Note } from "@better-fs-tools/read";

import type { WriteToolName } from "../contract/context.ts";
import type { WriteFormatter } from "../contract/format.ts";
import type { FileChange, MutationReport, Snippet } from "../contract/result.ts";

export interface WriteFormatterOptions {
  /** Default: `${line}|`, the read tool's default gutter. Used by edit snippets. */
  readonly gutter?: (line: number) => string;
  /** Add FileChange.diff to the model text. Default false (W8). */
  readonly diff?: boolean;
  /** Default: `[${tool}:${note.code}] ${note.message}`. */
  readonly noteLine?: (note: Note, tool: WriteToolName) => string;
}

/**
 * The header, then the body, then a blank line and the note lines. An error
 * prints the note lines only. "view" mode returns the header and body only.
 */
export function defaultWriteFormatter(
  options: WriteFormatterOptions = {},
): WriteFormatter<unknown> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("defaultWriteFormatter options must be an object");
  }
  const { gutter = defaultGutter, diff = false, noteLine = defaultNoteLine } = options;
  if (typeof gutter !== "function") {
    throw new TypeError("gutter must be a function");
  }
  if (typeof diff !== "boolean") throw new TypeError("diff must be a boolean");
  if (typeof noteLine !== "function") throw new TypeError("noteLine must be a function");
  return Object.freeze<WriteFormatter<unknown>>({
    id: "default",
    format(report, ctx) {
      const main = [
        ...body(report, gutter, ctx.limits.maxListedMatches),
        ...(diff ? diffBlocks(report.changes) : []),
      ];
      if (ctx.mode === "view") return main.join("\n");
      const notes = report.notes.map((note) => noteLine(note, report.tool));
      if (notes.length === 0) return main.join("\n");
      if (main.length === 0) return notes.join("\n");
      return `${main.join("\n")}\n\n${notes.join("\n")}`;
    },
  });
}

function defaultNoteLine(note: Note, tool: WriteToolName): string {
  return `[${tool}:${note.code}] ${note.message}`;
}

function defaultGutter(line: number): string {
  return `${line}|`;
}

function body(report: MutationReport, gutter: (line: number) => string, listed: number): string[] {
  if (report.status === "error") return [];
  if (report.status === "no-change") {
    const reason = report.tool === "write" ? ": the content is the same" : "";
    return report.unchanged.map((path) => `No change to ${path}${reason}.`);
  }
  if (report.tool === "edit") {
    return report.changes.flatMap((change) => [
      editLine(change, listed),
      ...snippetLines(change.snippets, gutter),
    ]);
  }
  return report.changes.map(changeLine);
}

/**
 * `Edited <path>: <n> replacements at lines <list>.` The list names each
 * replacement's lines in the new file, sorted, at most `listed` of them.
 */
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

/** Each snippet's lines behind the gutter. Snippets are separated by a line "...". */
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
