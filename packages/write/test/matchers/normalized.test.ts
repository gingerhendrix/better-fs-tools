import { describe, expect, test } from "bun:test";

import { normalizedMatcher } from "../../src/index.ts";
import { LINES, TEXT, hits } from "./helpers.ts";

describe("normalizedMatcher", () => {
  const normalized = normalizedMatcher();

  test("id and fuzzy flag", () => {
    expect([normalized.id, normalized.fuzzy, normalized.adapt]).toEqual([
      "normalized",
      true,
      undefined,
    ]);
  });

  test("trailing spaces, tabs, and a CR before LF fold away", () => {
    expect(hits(normalized, "a = 1;  \t\nb = 2;\n", "a = 1;\nb = 2;")).toEqual([
      "a = 1;  \t\nb = 2;",
    ]);
    expect(hits(normalized, "a = 1;\r\nb = 2;\r\n", "a = 1;\nb = 2;")).toEqual([
      "a = 1;\r\nb = 2;",
    ]);
    expect(hits(normalized, "a = 1;\nb = 2;\n", "a = 1;   \nb = 2;")).toEqual(["a = 1;\nb = 2;"]);
  });

  test("curly quotes, Unicode dashes, and special spaces", () => {
    expect(hits(normalized, "say(\u201chi\u201d, \u2018x\u2019);", "say(\"hi\", 'x');")).toEqual([
      "say(\u201chi\u201d, \u2018x\u2019);",
    ]);
    expect(hits(normalized, "a \u2014 b \u2212 c", "a - b - c")).toEqual(["a \u2014 b \u2212 c"]);
    expect(hits(normalized, "a\u00a0b\u3000c\u2009d", "a b c d")).toEqual([
      "a\u00a0b\u3000c\u2009d",
    ]);
    expect(hits(normalized, 'x = "y"', "x = \u201cy\u201d")).toEqual(['x = "y"']);
  });

  test("NFKC, with combining marks kept in one span", () => {
    expect(hits(normalized, "\uff21\uff22\uff23 = 1", "ABC = 1")).toEqual([
      "\uff21\uff22\uff23 = 1",
    ]);
    expect(hits(normalized, "caf\u00e9 bar", "cafe\u0301 bar")).toEqual(["caf\u00e9 bar"]);
    expect(hits(normalized, "cafe\u0301 bar", "caf\u00e9 bar")).toEqual(["cafe\u0301 bar"]);
  });

  test("a hit whose edge falls inside a folded span is marked for refusal", () => {
    // U+FB01 folds to "fi". A needle that starts at its "i" cannot map back.
    expect(hits(normalized, "de\ufb01ne x", "ine x")).toEqual(["\ufb01ne x (boundary)"]);
    expect(hits(normalized, "de\ufb01ne x", "def")).toEqual(["de\ufb01 (boundary)"]);
    expect(hits(normalized, "de\ufb01ne x", "define")).toEqual(["de\ufb01ne"]);
  });

  test("the range covers only the matched original text", () => {
    const haystack = "keep\u2014this\nfoo \u201cbar\u201d  \nkeep\u2014that\n";
    const [range] = normalized.find(haystack, 'foo "bar"\n', TEXT);
    expect(range).toEqual({ start: 10, end: 22 });
    expect(haystack.slice(0, range?.start)).toBe("keep\u2014this\n");
    expect(haystack.slice(range?.end)).toBe("keep\u2014that\n");
  });

  test("a needle with trailing blanks at its end must end at a line end", () => {
    expect(hits(normalized, "foobar\nfoo\n", "foo  ")).toEqual(["foo"]);
    expect(hits(normalized, "foo \t\nx", "foo  ")).toEqual(["foo \t"]);
    expect(hits(normalized, "foobar", "foo ")).toEqual([]);
  });

  test("blank needles find nothing", () => {
    expect(normalized.find("a  \nb", "   ", TEXT)).toEqual([]);
    expect(normalized.find("a", "", TEXT)).toEqual([]);
  });

  test("honours from and maxMatches", () => {
    const haystack = "x \u2014 y\nx \u2014 y\nx \u2014 y\n";
    expect(normalized.find(haystack, "x - y", { ...TEXT, from: 1 })).toEqual([
      { start: 6, end: 11 },
      { start: 12, end: 17 },
    ]);
    expect(normalized.find(haystack, "x - y", { ...TEXT, maxMatches: 1 })).toHaveLength(1);
  });

  test("lines mode: whole lines, trailing blanks included", () => {
    const haystack = "a\u2014b  \nxa\u2014b\na\u2014b\t\n";
    expect(normalized.find(haystack, "a-b", LINES)).toEqual([
      { start: 0, end: 5 },
      { start: 11, end: 15 },
    ]);
    expect(normalized.find("x\n  \n\u201cq\u201d\n", '"q"', LINES)).toEqual([{ start: 5, end: 8 }]);
  });

  test("never throws on odd input", () => {
    const odd = ["\ud800", "\udc00x", "\u0301", "\r", "\n\u0301", "\u{1d165}"];
    for (const haystack of odd) {
      for (const needle of odd) {
        expect(() => normalized.find(haystack, needle, TEXT)).not.toThrow();
        expect(() => normalized.find(haystack, needle, LINES)).not.toThrow();
      }
    }
  });
});
