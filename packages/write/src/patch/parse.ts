import type {
  PatchHunk,
  PatchLine,
  PatchOperation,
  PatchParseOutcome,
  PatchParser,
} from "../contract/patch.ts";

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const END_OF_FILE = "*** End of File";
const ADD = /^\*\*\* Add File:(.*)$/u;
const DELETE = /^\*\*\* Delete File:(.*)$/u;
const UPDATE = /^\*\*\* Update File:(.*)$/u;
const MOVE = /^\*\*\* Move to:(.*)$/u;
const ENVIRONMENT = /^\*\*\* Environment ID:/u;
const FENCE_OPEN = /^```[\w+-]*$/u;
const FENCE_CLOSE = /^```$/u;
/** `apply_patch <<'EOF'`, `<<EOF`, or `<<"EOF"`. Group 2 is the tag. */
const HEREDOC = /^(?:(?:apply_patch|applypatch)\s+)?<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1$/u;

/** A parse failure at a one-based line of the text as given. */
class PatchSyntaxError extends Error {
  constructor(
    readonly line: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/**
 * Parses the Codex patch format. Lenient at the edges: CRLF line breaks,
 * surrounding blank lines, one fenced block, and one heredoc wrapper
 * (`apply_patch <<'EOF'`) are stripped, and a missing final newline is fine.
 * Line numbers in errors and in the plan count lines of the text as given.
 * Never throws.
 */
export function parsePatch(text: string): PatchParseOutcome {
  if (typeof text !== "string") {
    return { ok: false, error: { line: 1, detail: "the patch must be a string" } };
  }
  try {
    return { ok: true, plan: { operations: new Parser(text).parse() } };
  } catch (error) {
    if (!(error instanceof PatchSyntaxError)) throw error;
    return { ok: false, error: { line: error.line, detail: error.detail } };
  }
}

/** The default patch parser: parsePatch as a PatchParser. */
export function codexPatchParser(): PatchParser {
  return Object.freeze<PatchParser>({ id: "codex", parse: parsePatch });
}

class Parser {
  private readonly lines: string[];
  /** Index of the first line of the patch body, after the wrappers. */
  private first = 0;
  /** Index of the last line of the patch body, after the wrappers. */
  private last: number;
  private at = 0;

  constructor(text: string) {
    this.lines = text.replaceAll("\r\n", "\n").split("\n");
    this.last = this.lines.length - 1;
  }

  parse(): PatchOperation[] {
    this.unwrap();
    if (this.first > this.last) throw new PatchSyntaxError(1, "the patch is empty");
    if (this.trimmed(this.first) !== BEGIN) {
      throw new PatchSyntaxError(this.first + 1, `the first line must be "${BEGIN}"`);
    }
    if (this.last === this.first || this.trimmed(this.last) !== END) {
      throw new PatchSyntaxError(this.last + 1, `the last line must be "${END}"`);
    }
    const operations: PatchOperation[] = [];
    this.at = this.first + 1;
    while (this.at < this.last) {
      const line = this.trimmed(this.at);
      if (line === "") {
        this.at += 1;
        continue;
      }
      operations.push(this.operation(line));
    }
    if (operations.length === 0) {
      throw new PatchSyntaxError(this.last + 1, "the patch has no file operations");
    }
    return operations;
  }

  /** Strips blank lines, then one fenced block, then one heredoc wrapper, at both ends. */
  private unwrap(): void {
    this.trimBlank();
    if (
      this.first < this.last &&
      FENCE_OPEN.test(this.trimmed(this.first)) &&
      FENCE_CLOSE.test(this.trimmed(this.last))
    ) {
      this.first += 1;
      this.last -= 1;
      this.trimBlank();
    }
    const heredoc = this.first < this.last ? HEREDOC.exec(this.trimmed(this.first)) : null;
    if (heredoc !== null && this.trimmed(this.last) === heredoc[2]) {
      this.first += 1;
      this.last -= 1;
      this.trimBlank();
    }
  }

  private trimBlank(): void {
    while (this.first <= this.last && this.trimmed(this.first) === "") this.first += 1;
    while (this.last >= this.first && this.trimmed(this.last) === "") this.last -= 1;
  }

  private trimmed(index: number): string {
    return (this.lines[index] ?? "").trim();
  }

  private raw(index: number): string {
    return this.lines[index] ?? "";
  }

  /** One operation, starting at its header line. */
  private operation(header: string): PatchOperation {
    const line = this.at + 1;
    if (ENVIRONMENT.test(header)) {
      throw new PatchSyntaxError(line, "*** Environment ID is not supported. Remove the line.");
    }
    const add = ADD.exec(header);
    if (add !== null) return this.add(this.path(add[1], line), line);
    const remove = DELETE.exec(header);
    if (remove !== null) {
      this.at += 1;
      return { kind: "delete", path: this.path(remove[1], line), line };
    }
    const update = UPDATE.exec(header);
    if (update !== null) return this.update(this.path(update[1], line), line);
    throw new PatchSyntaxError(
      line,
      `${JSON.stringify(header)} is not a valid operation header. Use "*** Add File: <path>", "*** Delete File: <path>", or "*** Update File: <path>".`,
    );
  }

  private path(value: string | undefined, line: number): string {
    const path = (value ?? "").trim();
    if (path === "") throw new PatchSyntaxError(line, "the file path is empty");
    return path;
  }

  /** "*** Add File:" and one or more "+" lines. */
  private add(path: string, line: number): PatchOperation {
    this.at += 1;
    const content: string[] = [];
    while (this.at < this.last && this.raw(this.at).startsWith("+")) {
      content.push(this.raw(this.at).slice(1));
      this.at += 1;
    }
    if (content.length === 0) {
      throw new PatchSyntaxError(line, `*** Add File: ${path} needs at least one "+" line`);
    }
    return { kind: "add", path, content: `${content.join("\n")}\n`, line };
  }

  /** "*** Update File:", an optional "*** Move to:", then hunks. */
  private update(path: string, line: number): PatchOperation {
    this.at += 1;
    let moveTo: string | null = null;
    const move = this.at < this.last ? MOVE.exec(this.trimmed(this.at)) : null;
    if (move !== null) {
      moveTo = this.path(move[1], this.at + 1);
      this.at += 1;
    }
    const hunks: PatchHunk[] = [];
    while (this.at < this.last) {
      const raw = this.raw(this.at);
      // Blank lines between hunks are skipped (Codex).
      if (raw.trim() === "") {
        this.at += 1;
        continue;
      }
      if (raw.startsWith("***")) break;
      hunks.push(this.hunk(hunks.length === 0));
    }
    if (hunks.length === 0 && moveTo === null) {
      throw new PatchSyntaxError(
        line,
        `*** Update File: ${path} needs at least one hunk or a "*** Move to:" line`,
      );
    }
    return { kind: "update", path, moveTo, hunks, line };
  }

  /**
   * One hunk: "@@" or "@@ <context>", then " ", "-", and "+" lines, then an
   * optional "*** End of File". The first hunk of a file may leave out "@@".
   * An empty line inside a hunk is an empty context line (Codex).
   */
  private hunk(first: boolean): PatchHunk {
    const line = this.at + 1;
    const head = this.raw(this.at);
    let context: string | null = null;
    if (head.trimEnd() === "@@") {
      this.at += 1;
    } else if (head.startsWith("@@ ")) {
      context = head.slice(3);
      this.at += 1;
    } else if (!first) {
      throw new PatchSyntaxError(line, `a hunk must start with "@@", got ${JSON.stringify(head)}`);
    }
    const lines: PatchLine[] = [];
    let endOfFile = false;
    while (this.at < this.last) {
      const raw = this.raw(this.at);
      if (raw.trimEnd() === END_OF_FILE) {
        if (lines.length === 0) throw new PatchSyntaxError(this.at + 1, "the hunk has no lines");
        endOfFile = true;
        this.at += 1;
        break;
      }
      const kind = raw === "" ? " " : raw[0];
      if (kind === " " || kind === "-" || kind === "+") {
        lines.push({ kind, text: raw.slice(1) });
        this.at += 1;
        continue;
      }
      if (lines.length === 0) {
        throw new PatchSyntaxError(
          this.at + 1,
          `unexpected line ${JSON.stringify(raw)} in a hunk. Every hunk line starts with " " (context), "-" (removed), or "+" (added).`,
        );
      }
      break;
    }
    if (lines.length === 0) throw new PatchSyntaxError(line, "the hunk has no lines");
    return { context, lines, endOfFile, line };
  }
}
