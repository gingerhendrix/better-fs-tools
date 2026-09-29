import { describe, expect, test } from "bun:test";

import { LineIndex } from "../../src/core/line-index.ts";
import { buildSnippets } from "../../src/core/snippet.ts";
import { defaultWriteLimits } from "../../src/index.ts";

const file = `${Array.from({ length: 30 }, (_, index) => `l${index + 1}`).join("\n")}\n`;

describe("snippets", () => {
  test("snippetLines before and after each change", () => {
    expect(buildSnippets(file, [[10, 11]], defaultWriteLimits)).toEqual([
      { startLine: 7, lines: ["l7", "l8", "l9", "l10", "l11", "l12", "l13", "l14"] },
    ]);
  });

  test("snippets that touch merge; others stay apart", () => {
    const limits = { ...defaultWriteLimits, snippetLines: 1 };
    expect(
      buildSnippets(
        file,
        [
          [5, 5],
          [8, 8],
          [20, 20],
        ],
        limits,
      ),
    ).toEqual([
      { startLine: 4, lines: ["l4", "l5", "l6", "l7", "l8", "l9"] },
      { startLine: 19, lines: ["l19", "l20", "l21"] },
    ]);
  });

  test("clamped at the file edges", () => {
    const limits = { ...defaultWriteLimits, snippetLines: 2 };
    expect(buildSnippets("a\nb\n", [[1, 1]], limits)).toEqual([
      { startLine: 1, lines: ["a", "b"] },
    ]);
    expect(buildSnippets("a\nb\n", [[3, 3]], limits)).toEqual([
      { startLine: 1, lines: ["a", "b"] },
    ]);
    expect(buildSnippets("", [[1, 1]], limits)).toEqual([]);
  });

  test("at most maxSnippetLines lines for the file", () => {
    const limits = { ...defaultWriteLimits, snippetLines: 1, maxSnippetLines: 4 };
    expect(
      buildSnippets(
        file,
        [
          [2, 2],
          [10, 10],
        ],
        limits,
      ),
    ).toEqual([
      { startLine: 1, lines: ["l1", "l2", "l3"] },
      { startLine: 9, lines: ["l9"] },
    ]);
  });

  test("long lines are clamped with the read tool's marker, and a CR before LF is not shown", () => {
    const long = "x".repeat(2_100);
    const [snippet] = buildSnippets(`${long}\r\nb\r\n`, [[1, 1]], defaultWriteLimits);
    expect(snippet?.lines).toEqual([`${"x".repeat(2_000)}… [line truncated at 2000 chars]`, "b"]);
  });
});

describe("LineIndex", () => {
  test("line numbers, spans, and counts", () => {
    const index = new LineIndex("a\nbb\n\nc");
    expect(index.count).toBe(4);
    expect([0, 1, 2, 4, 5, 6, 7].map((offset) => index.lineOf(offset))).toEqual([
      1, 1, 2, 2, 3, 4, 4,
    ]);
    expect(index.span(2, 5)).toEqual([2, 2]);
    expect(index.span(2, 6)).toEqual([2, 3]);
    expect(index.span(4, 4)).toEqual([2, 2]);
    expect(new LineIndex("a\n").count).toBe(1);
    expect(new LineIndex("").count).toBe(0);
  });
});
