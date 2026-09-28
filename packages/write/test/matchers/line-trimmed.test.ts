import { describe, expect, test } from "bun:test";

import { lineTrimmedMatcher } from "../../src/index.ts";
import { LINES, TEXT, hits } from "./helpers.ts";

describe("lineTrimmedMatcher", () => {
  const trimmed = lineTrimmedMatcher();
  const haystack = "fn() {\n    a();\n\tb();  \n}\n";

  test("id and fuzzy flag", () => {
    expect([trimmed.id, trimmed.fuzzy]).toEqual(["line-trimmed", true]);
  });

  test("compares whole lines with both ends trimmed and covers whole lines", () => {
    expect(hits(trimmed, haystack, "a();\n  b();")).toEqual(["    a();\n\tb();  "]);
  });

  test("a needle that ends with a newline takes the line break too", () => {
    expect(hits(trimmed, haystack, "a();\nb();\n")).toEqual(["    a();\n\tb();  \n"]);
    expect(hits(trimmed, "x\n  y", "y\n")).toEqual([]);
  });

  test("hits do not overlap and honour from and maxMatches", () => {
    const repeated = " a\n a\n a\n a\n";
    expect(hits(trimmed, repeated, "a\na")).toEqual([" a\n a", " a\n a"]);
    expect(trimmed.find(repeated, "a", { ...TEXT, from: 1 })).toEqual([
      { start: 3, end: 5 },
      { start: 6, end: 8 },
      { start: 9, end: 11 },
    ]);
    expect(trimmed.find(repeated, "a", { ...TEXT, maxMatches: 1 })).toHaveLength(1);
  });

  test("blank needles find nothing", () => {
    expect(trimmed.find("a\n\n  \nb", " \n ", TEXT)).toEqual([]);
  });

  test("lines mode gives the same whole-line ranges", () => {
    expect(trimmed.find(haystack, "a();", LINES)).toEqual([{ start: 7, end: 15 }]);
  });
});
