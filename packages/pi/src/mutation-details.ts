import type { FileChange, MutationResult } from "@better-fs-tools/write";

/** Pi's EditToolDetails shape, so Pi's built-in edit renderer draws the diff. */
export interface PiMutationDetails {
  /** Pi's display diff, with lines like "+NN text", "-NN text", " NN text", and "...". */
  diff: string;
  /** Unified diff of every change. */
  patch: string;
  firstChangedLine?: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

interface Row {
  readonly kind: " " | "-" | "+" | "...";
  readonly line: number;
  readonly text: string;
}

/**
 * Converts an edit or apply_patch result to Pi's edit details, so Pi draws the
 * diff. Returns undefined for an error or a result with no changes. With more
 * than one file, each file's lines follow a line with its path.
 */
export function toPiMutationDetails(result: MutationResult): PiMutationDetails | undefined {
  if (result.status !== "ok" || result.changes.length === 0) return undefined;
  const blocks: string[] = [];
  let firstChangedLine: number | undefined;
  for (const change of result.changes) {
    const display = toPiDisplayDiff(change.diff);
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

// Context and removed lines carry the old line number, added lines the new one, as Pi's generateDiffString does.
function toPiDisplayDiff(unified: string): { text: string; firstChangedLine: number | undefined } {
  const rows: Row[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let firstChangedLine: number | undefined;
  for (const raw of unified.split("\n")) {
    const hunk = HUNK_HEADER.exec(raw);
    if (hunk !== null) {
      if (inHunk) rows.push({ kind: "...", line: 0, text: "" });
      inHunk = true;
      oldLine = firstLineOfRange(hunk[1], hunk[2]);
      newLine = firstLineOfRange(hunk[3], hunk[4]);
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

// In a unified diff, a range with a zero count names the line before it.
function firstLineOfRange(line: string | undefined, count: string | undefined): number {
  const value = Number(line);
  return count === "0" ? value + 1 : value;
}
