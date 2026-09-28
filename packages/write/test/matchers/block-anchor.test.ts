import { describe, expect, test } from "bun:test";

import { blockAnchorMatcher } from "../../src/index.ts";
import { TEXT, hits } from "./helpers.ts";

describe("blockAnchorMatcher", () => {
  const anchor = blockAnchorMatcher();
  const haystack = "a\nfunction f() {\n  one();\n  two();\n  three();\n}\nz\n";

  test("id and fuzzy flag", () => {
    expect([anchor.id, anchor.fuzzy]).toEqual(["block-anchor", true]);
  });

  test("first and last lines anchor; half of the middle lines must appear", () => {
    expect(hits(anchor, haystack, "function f() {\n  one();\n  TWO();\n  three();\n}")).toEqual([
      "function f() {\n  one();\n  two();\n  three();\n}",
    ]);
    expect(
      anchor.find(haystack, "function f() {\n  ONE();\n  TWO();\n  three();\n}", TEXT),
    ).toEqual([]);
  });

  test("the window may hold more or fewer lines than the needle", () => {
    expect(hits(anchor, haystack, "function f() {\n  two();\n}")).toEqual([
      "function f() {\n  one();\n  two();\n  three();\n}",
    ]);
  });

  test("the window is at most maxSpanRatio times the needle's lines", () => {
    const tight = blockAnchorMatcher({ maxSpanRatio: 1.5 });
    expect(tight.find(haystack, "function f() {\n  two();\n}", TEXT)).toEqual([]);
  });

  test("needs 3 lines and non-blank anchors", () => {
    expect(anchor.find(haystack, "function f() {\n}", TEXT)).toEqual([]);
    expect(anchor.find("\nx\n\n", "\nx\n", TEXT)).toEqual([]);
  });

  test("rejects bad options", () => {
    expect(() => blockAnchorMatcher({ maxSpanRatio: 0.5 })).toThrow(TypeError);
    expect(() => blockAnchorMatcher({ maxSpanRatio: Number.NaN })).toThrow(TypeError);
    expect(() => blockAnchorMatcher(null as never)).toThrow(TypeError);
  });
});
