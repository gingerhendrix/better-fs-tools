import type { FileConverter } from "../contract/extensions.ts";
import type { ReadNote } from "../contract/result.ts";
import { isRecord } from "../core/input.ts";
import { collect, hasCode } from "./shared.ts";

export interface NotebookConverterOptions {
  /** Render cell outputs after each code cell. Default true. */
  outputs?: boolean;
}

/**
 * Accepts classification code "NOTEBOOK". Renders cells as text: a
 * `[cell N: type]` line, the source, and for code cells the text outputs.
 * Rich outputs are named, not shown. A file that is not notebook JSON is
 * refused with code "INVALID_NOTEBOOK".
 */
export function notebookConverter(options: NotebookConverterOptions = {}): FileConverter<unknown> {
  const outputs = options.outputs ?? true;
  if (typeof outputs !== "boolean")
    throw new TypeError("notebookConverter outputs must be a boolean");
  return Object.freeze<FileConverter<unknown>>({
    id: "notebook",
    target: "file",
    accepts: (match) => hasCode(match.classification, "NOTEBOOK"),
    async convert(input) {
      const cells = parseCells(await collect(input.bytes()));
      if (cells === null) {
        return { kind: "refuse", code: "INVALID_NOTEBOOK", note: invalid(input.info.displayPath) };
      }
      const blocks = cells.map((cell, index) => renderCell(cell, index + 1, outputs));
      return { kind: "text", text: blocks.join("\n\n"), mimeType: "text/plain" };
    },
  });
}

interface Cell {
  readonly type: string;
  readonly source: string;
  readonly outputs: readonly unknown[];
}

function parseCells(bytes: Uint8Array): Cell[] | null {
  let notebook: unknown;
  try {
    notebook = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!isRecord(notebook) || !Array.isArray(notebook.cells)) return null;
  const cells: Cell[] = [];
  for (const cell of notebook.cells) {
    if (!isRecord(cell) || typeof cell.cell_type !== "string") return null;
    const source = multiline(cell.source);
    if (source === null) return null;
    cells.push({
      type: cell.cell_type,
      source,
      outputs: Array.isArray(cell.outputs) ? cell.outputs : [],
    });
  }
  return cells;
}

function renderCell(cell: Cell, number: number, outputs: boolean): string {
  const lines = [`[cell ${number}: ${cell.type}]`];
  if (cell.source !== "") lines.push(trimEnd(cell.source));
  if (outputs && cell.type === "code") {
    for (const output of cell.outputs) {
      const text = renderOutput(output);
      if (text !== null) lines.push("[output]", trimEnd(text));
    }
  }
  return lines.join("\n");
}

/** stream text, text/plain data, or an error line. Other data types are named only. */
function renderOutput(output: unknown): string | null {
  if (!isRecord(output)) return null;
  switch (output.output_type) {
    case "stream":
      return multiline(output.text);
    case "execute_result":
    case "display_data": {
      if (!isRecord(output.data)) return null;
      const plain =
        output.data["text/plain"] === undefined ? null : multiline(output.data["text/plain"]);
      if (plain !== null) return plain;
      const types = Object.keys(output.data);
      return types.length === 0 ? null : `[${types.join(", ")} output not shown]`;
    }
    case "error":
      return `${String(output.ename ?? "Error")}: ${String(output.evalue ?? "")}`;
    default:
      return null;
  }
}

/** Jupyter text: a string, or an array of strings that already hold their newlines. */
function multiline(value: unknown): string | null {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
    return value.join("");
  }
  return null;
}

function trimEnd(text: string): string {
  return text.replace(/(?:\r?\n)+$/u, "");
}

function invalid(path: string): ReadNote {
  return {
    code: "invalid-notebook",
    severity: "warning",
    message: `${path} looks like a Jupyter notebook but is not valid notebook JSON.`,
  };
}
