/**
 * Port of the Oh My Pi `typescript-edit-benchmark` verifier (MIT, Stencil Labs).
 *
 * Both files are formatted with Prettier before the compare. For code files,
 * blank-line count is ignored, and a line that differs only in whitespace
 * takes the expected text. So a correct edit with a stray blank line or a
 * wrong indent still passes, as it does in the original.
 */
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { diffLines } from "diff";
import * as prettier from "prettier";

import { listFiles } from "./tasks.ts";

export interface Verification {
  readonly passed: boolean;
  readonly error: string | null;
  /** Lines that differ after formatting. 0 on a pass. */
  readonly linesChanged: number;
}

const PRETTIER_OPTIONS: prettier.Options = {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: "as-needed",
  trailingComma: "all",
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
  proseWrap: "preserve",
};

const PARSERS: Partial<Record<string, prettier.BuiltInParserName>> = {
  ".js": "flow",
  ".jsx": "flow",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".json": "json",
  ".md": "markdown",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".css": "css",
};

const BLANK_SENSITIVE = new Set([".md", ".mdx", ".yml", ".yaml"]);

export async function verifyWorkspace(
  expectedDir: string,
  actualDir: string,
): Promise<Verification> {
  const expectedFiles = await listFiles(expectedDir);
  const actualFiles = await listFiles(actualDir);
  const missing = expectedFiles.filter((f) => !actualFiles.includes(f));
  const extra = actualFiles.filter((f) => !expectedFiles.includes(f));
  if (missing.length > 0 || extra.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    if (extra.length > 0) parts.push(`unexpected: ${extra.join(", ")}`);
    return { passed: false, error: parts.join("; "), linesChanged: -1 };
  }
  for (const file of expectedFiles) {
    const expected = await readFile(join(expectedDir, file), "utf8");
    const actual = await readFile(join(actualDir, file), "utf8");
    const result = await compareFile(file, expected, actual);
    if (!result.passed) return result;
  }
  return { passed: true, error: null, linesChanged: 0 };
}

export async function compareFile(
  file: string,
  expectedRaw: string,
  actualRaw: string,
): Promise<Verification> {
  const expected = normalizeLineEndings(expectedRaw);
  const actual = restoreWhitespaceOnlyLineDiffs(expected, normalizeLineEndings(actualRaw));
  const expectedFormatted = await format(file, collapseBlankRuns(expected));
  const actualFormatted = await format(file, collapseBlankRuns(actual));
  const blankSensitive = BLANK_SENSITIVE.has(extname(file).toLowerCase());
  const equal = blankSensitive
    ? expectedFormatted === actualFormatted
    : stripBlankLines(expectedFormatted) === stripBlankLines(actualFormatted);
  if (equal) return { passed: true, error: null, linesChanged: 0 };
  return {
    passed: false,
    error: `file mismatch: ${file}`,
    linesChanged: countChangedLines(expectedFormatted, actualFormatted),
  };
}

async function format(file: string, content: string): Promise<string> {
  const parser = PARSERS[extname(file).toLowerCase()];
  if (parser === undefined) return content;
  try {
    return await prettier.format(content, { ...PRETTIER_OPTIONS, parser });
  } catch {
    return content;
  }
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

function stripBlankLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n");
}

function splitLines(value: string): string[] {
  return value.split("\n").filter((line, i, all) => i < all.length - 1 || line !== "");
}

function countChangedLines(expected: string, actual: string): number {
  let n = 0;
  for (const change of diffLines(expected, actual)) {
    if (change.added || change.removed) n += splitLines(change.value).length;
  }
  return n;
}

/** Pairs removed and added lines. A pair equal after removing whitespace keeps the expected line. */
function restoreWhitespaceOnlyLineDiffs(expected: string, actual: string): string {
  const out: string[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    const pairs = Math.min(removed.length, added.length);
    for (let i = 0; i < pairs; i++) {
      const r = removed[i]!;
      const a = added[i]!;
      out.push(r.replace(/\s+/g, "") === a.replace(/\s+/g, "") ? r : a);
    }
    for (let i = pairs; i < added.length; i++) out.push(added[i]!);
    removed = [];
    added = [];
  };
  for (const change of diffLines(expected, actual)) {
    const lines = splitLines(change.value);
    if (change.removed) removed.push(...lines);
    else if (change.added) added.push(...lines);
    else {
      flush();
      out.push(...lines);
    }
  }
  flush();
  const joined = out.join("\n");
  return actual.endsWith("\n") ? `${joined}\n` : joined;
}
