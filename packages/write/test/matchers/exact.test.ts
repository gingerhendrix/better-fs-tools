import { describe, expect, test } from "bun:test";

import { exactMatcher } from "../../src/index.ts";
import { LINES, TEXT } from "./helpers.ts";

describe("exactMatcher", () => {
  const exact = exactMatcher();

  test("id, fuzzy flag, and description", () => {
    expect([exact.id, exact.fuzzy, exact.adapt]).toEqual(["exact", false, undefined]);
    expect(exact.describe).not.toBe("");
  });

  test("finds every hit in order, without overlap", () => {
    expect(exact.find("aaaa", "aa", TEXT)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    expect(exact.find("x a x a", "a", TEXT)).toEqual([
      { start: 2, end: 3 },
      { start: 6, end: 7 },
    ]);
  });

  test("honours from and maxMatches", () => {
    expect(exact.find("a a a", "a", { ...TEXT, from: 1 })).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 5 },
    ]);
    expect(exact.find("a a a", "a", { ...TEXT, maxMatches: 2 })).toHaveLength(2);
  });

  test("an empty needle finds nothing", () => {
    expect(exact.find("abc", "", TEXT)).toEqual([]);
  });

  test("lines mode keeps line-aligned hits only", () => {
    const haystack = "xfoo\nfoo\nfoo bar\nfoo";
    expect(exact.find(haystack, "foo", LINES)).toEqual([
      { start: 5, end: 8 },
      { start: 17, end: 20 },
    ]);
    expect(exact.find("a\nb\nc\n", "b\n", LINES)).toEqual([{ start: 2, end: 4 }]);
    expect(exact.find("a\nb\n", "a\nb", LINES)).toEqual([{ start: 0, end: 3 }]);
  });
});
