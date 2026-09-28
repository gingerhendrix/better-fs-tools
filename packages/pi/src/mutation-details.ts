import type { FileChange, MutationResult } from "@better-fs-tools/write";

/** Pi's EditToolDetails shape, so Pi's built-in edit renderer draws the diff. */
export interface PiMutationDetails {
  /** Pi display diff: "+NN text", "-NN text", " NN text", "..." (core/tools/edit-diff.js generateDiffString). */
  diff: string;
  /** Unified diff of every change. */
  patch: string;
  firstChangedLine?: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

interface Row {
  readonly kind: " " | "-" | "+" | "...";
  readonly line: number;
  readonly text: string;
}

/**
 * Details for an `edit` or `apply_patch` result with changes. Anything else
 * (an error, `no-change`, a result with no changes) gives undefined, as Pi's
 * own edit does on an error. With more than one file, each file's lines
 * follow a line with its path, which Pi draws as context.
 */
export function toPiMutationDetails(result: MutationResult): PiMutationDetails | undefined {
  if (result.status !== "ok" || result.changes.length === 0) return undefined;
  const blocks: string[] = [];
  let firstChangedLine: number | undefined;
  for (const change of result.changes) {
    const display = displayDiff(change.diff);
    firstChangedLine ??= display.firstChangedLine;
    const header = result.changes.length > 1 ? `${label(change)}\n` : "";
    blocks.push(`${header}${display.text}`);
  }
  return {
    diff: blocks.join("\n"),
    patch: result.changes.map((change) => change.diff).join(""),
    ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
  };
}

function label(change: FileChange): string {
  return change.movedFrom === null ? change.path : `${change.movedFrom} → ${change.path}`;
}

/**
 * Converts one unified diff (FileChange.diff) to Pi's display lines. Line
 * numbers are padded to the widest one shown. Context and removed lines carry
 * the old line number, added lines the new one, as generateDiffString does.
 * Hunks are joined by a "..." row.
 */
function displayDiff(unified: string): { text: string; firstChangedLine: number | undefined } {
  const rows: Row[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let firstChangedLine: number | undefined;
  for (const raw of unified.split("\n")) {
    const hunk = HUNK.exec(raw);
    if (hunk !== null) {
      if (inHunk) rows.push({ kind: "...", line: 0, text: "" });
      inHunk = true;
      oldLine = start(hunk[1], hunk[2]);
      newLine = start(hunk[3], hunk[4]);
      continue;
    }
    if (!inHunk || raw.startsWith("\\")) continue;
    const kind = raw[0];
    const text = raw.slice(1);
    if (kind === "+") {
      firstChangedLine ??= newLine;
      rows.push({ kind, line: newLine, text });
      newLine += 1;
    } else if (kind === "-") {
      firstChangedLine ??= newLine;
      rows.push({ kind, line: oldLine, text });
      oldLine += 1;
    } else if (kind === " ") {
      rows.push({ kind, line: oldLine, text });
      oldLine += 1;
      newLine += 1;
    }
  }
  const width = String(Math.max(1, ...rows.map((row) => row.line))).length;
  const text = rows
    .map((row) =>
      row.kind === "..."
        ? ` ${"".padStart(width, " ")} ...`
        : `${row.kind}${String(row.line).padStart(width, " ")} ${row.text}`,
    )
    .join("\n");
  return { text, firstChangedLine };
}

/** A unified range start. A zero count names the line before, so the next line is start + 1. */
function start(line: string | undefined, count: string | undefined): number {
  const value = Number(line);
  return count === "0" ? value + 1 : value;
}
