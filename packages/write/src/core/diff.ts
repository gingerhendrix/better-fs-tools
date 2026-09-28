/** Context lines around each change in a hunk, as in `diff -u`. */
const CONTEXT = 3;
/** Work bound for the Myers search: (lines before + lines after) × edit distance. */
const MAX_WORK = 20_000_000;
/** Edit distance bound. Past it the middle is shown as removed, then added. */
const MAX_DISTANCE = 1_000;

export interface LineDiff {
  readonly linesAdded: number;
  readonly linesRemoved: number;
  /** Unified diff with a/ and b/ headers. Empty when nothing changed. */
  readonly text: string;
  /** The text was cut at maxLines. The counts are still exact for the edit script. */
  readonly truncated: boolean;
  /**
   * One-based inclusive line ranges in `after` of each run of changed lines.
   * A run that only removes lines gives the line after the removal.
   */
  readonly changed: readonly (readonly [number, number])[];
}

type Op = { readonly kind: " " | "-" | "+"; readonly token: string };

/**
 * A unified diff of two texts, line by line. `before` null is a create
 * (--- /dev/null), `after` null a delete. `beforePath` names the old side
 * of a move. A last line without a newline gets the usual
 * "\ No newline at end of file" marker. The search is bounded:
 * past the bound the changed middle is shown as one removal and one addition,
 * so the counts may then be larger than a minimal diff's.
 */
export function unifiedDiff(
  before: string | null,
  after: string | null,
  path: string,
  maxLines: number,
  beforePath: string = path,
): LineDiff {
  const a = tokens(before ?? "");
  const b = tokens(after ?? "");
  const ops = editScript(a, b);
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const op of ops) {
    if (op.kind === "+") linesAdded += 1;
    else if (op.kind === "-") linesRemoved += 1;
  }
  if (linesAdded === 0 && linesRemoved === 0) {
    return { linesAdded, linesRemoved, text: "", truncated: false, changed: [] };
  }
  const name = path.replace(/^\/+/u, "");
  const out = new Output(maxLines);
  out.push(before === null ? "--- /dev/null" : `--- a/${beforePath.replace(/^\/+/u, "")}`);
  out.push(after === null ? "+++ /dev/null" : `+++ b/${name}`);
  for (const hunk of hunks(ops)) {
    if (out.full) break;
    out.push(hunk.header);
    for (const op of hunk.ops) {
      if (out.full) break;
      const newline = op.token.endsWith("\n");
      out.push(`${op.kind}${newline ? op.token.slice(0, -1) : op.token}`);
      if (!newline) out.push("\\ No newline at end of file");
    }
  }
  return {
    linesAdded,
    linesRemoved,
    text: out.text(),
    truncated: out.truncated,
    changed: changedRuns(ops),
  };
}

function changedRuns(ops: readonly Op[]): [number, number][] {
  const runs: [number, number][] = [];
  let line = 0;
  let index = 0;
  while (index < ops.length) {
    if ((ops[index] as Op).kind === " ") {
      line += 1;
      index += 1;
      continue;
    }
    const first = line + 1;
    let added = 0;
    while (index < ops.length && (ops[index] as Op).kind !== " ") {
      if ((ops[index] as Op).kind === "+") added += 1;
      index += 1;
    }
    line += added;
    runs.push([first, Math.max(first, line)]);
  }
  return runs;
}

/** Lines with their "\n". The last one has none when the text does not end with a newline. */
export function tokens(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  const last = parts.pop() ?? "";
  const lines = parts.map((part) => `${part}\n`);
  if (last !== "") lines.push(last);
  return lines;
}

class Output {
  private readonly lines: string[] = [];
  truncated = false;

  constructor(private readonly max: number) {}

  get full(): boolean {
    return this.truncated;
  }

  push(line: string): void {
    if (this.lines.length >= this.max) {
      this.truncated = true;
      return;
    }
    this.lines.push(line);
  }

  text(): string {
    return this.lines.length === 0 ? "" : `${this.lines.join("\n")}\n`;
  }
}

function editScript(a: readonly string[], b: readonly string[]): Op[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }
  const middleA = a.slice(head, a.length - tail);
  const middleB = b.slice(head, b.length - tail);
  const ops: Op[] = a.slice(0, head).map((token) => ({ kind: " ", token }));
  ops.push(...(myers(middleA, middleB) ?? replaceAll(middleA, middleB)));
  for (const token of a.slice(a.length - tail)) ops.push({ kind: " ", token });
  return ops;
}

function replaceAll(a: readonly string[], b: readonly string[]): Op[] {
  return [
    ...a.map((token) => ({ kind: "-" as const, token })),
    ...b.map((token) => ({ kind: "+" as const, token })),
  ];
}

/** Myers' O(ND) diff. null when the edit distance passes the bound. */
function myers(a: readonly string[], b: readonly string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return replaceAll(a, b);
  const max = Math.min(n + m, MAX_DISTANCE, Math.max(1, Math.floor(MAX_WORK / (n + m))));
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
          ? (v[offset + k + 1] ?? 0)
          : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace, d);
    }
  }
  return null;
}

/** Walks the saved rows back from (n, m) to (0, 0). Row d holds v[k] for k in -d-1..d+1. */
function backtrack(
  a: readonly string[],
  b: readonly string[],
  trace: readonly Int32Array[],
  distance: number,
): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = distance; d > 0; d -= 1) {
    const row = trace[d] as Int32Array;
    const at = (k: number) => row[k + d + 1] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      ops.push({ kind: " ", token: a[x] as string });
    }
    if (down) {
      y -= 1;
      ops.push({ kind: "+", token: b[y] as string });
    } else {
      x -= 1;
      ops.push({ kind: "-", token: a[x] as string });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    ops.push({ kind: " ", token: a[x] as string });
  }
  return ops.reverse();
}

interface Hunk {
  readonly header: string;
  readonly ops: readonly Op[];
}

/** Groups the script into hunks with CONTEXT lines around each change. Close changes share a hunk. */
function hunks(ops: readonly Op[]): Hunk[] {
  const changed: number[] = [];
  ops.forEach((op, index) => {
    if (op.kind !== " ") changed.push(index);
  });
  const result: Hunk[] = [];
  let start = 0;
  while (start < changed.length) {
    let end = start;
    while (
      end + 1 < changed.length &&
      (changed[end + 1] as number) - (changed[end] as number) <= 2 * CONTEXT + 1
    ) {
      end += 1;
    }
    const from = Math.max(0, (changed[start] as number) - CONTEXT);
    const to = Math.min(ops.length, (changed[end] as number) + CONTEXT + 1);
    result.push(hunk(ops, from, to));
    start = end + 1;
  }
  return result;
}

function hunk(ops: readonly Op[], from: number, to: number): Hunk {
  let oldLine = 0;
  let newLine = 0;
  for (let index = 0; index < from; index += 1) {
    const op = ops[index] as Op;
    if (op.kind !== "+") oldLine += 1;
    if (op.kind !== "-") newLine += 1;
  }
  const slice = ops.slice(from, to);
  const oldCount = slice.filter((op) => op.kind !== "+").length;
  const newCount = slice.filter((op) => op.kind !== "-").length;
  const range = (line: number, count: number) =>
    `${count === 0 ? line : line + 1}${count === 1 ? "" : `,${count}`}`;
  return {
    header: `@@ -${range(oldLine, oldCount)} +${range(newLine, newCount)} @@`,
    ops: slice,
  };
}
