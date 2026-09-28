import { describe, expect, test } from "bun:test";

import { escapeDrift, tooWide } from "../../src/core/match.ts";
import { exactMatcher } from "../../src/index.ts";
import type { Matcher, MatchContext } from "../../src/index.ts";
import { errorOf, harness, text } from "../helpers.ts";

function matcher(find: Matcher["find"], extra: Partial<Matcher> = {}): Matcher {
  return { id: "custom", fuzzy: false, describe: "custom", find, ...extra };
}

async function editWith(matchers: readonly Matcher[], file = "abc abc\n") {
  const setup = harness({ files: { "/f.ts": file }, editDeps: { matchers } });
  await setup.read({ path: "/f.ts" });
  return setup;
}

describe("matcher chain rules (section 5.4)", () => {
  test("each matcher sees text mode, from 0, and the listed-matches cap", async () => {
    const seen: MatchContext[] = [];
    const { edit } = await editWith([
      matcher((haystack, needle, ctx) => {
        seen.push(ctx);
        return exactMatcher().find(haystack, needle, ctx);
      }),
    ]);
    await edit({ path: "/f.ts", edits: [{ oldText: "c a", newText: "C A" }] });
    await edit({ path: "/f.ts", edits: [{ oldText: "b", newText: "B", replaceAll: true }] });
    expect(seen).toEqual([
      { mode: "text", from: 0, maxMatches: 11 },
      { mode: "text", from: 0, maxMatches: 100_001 },
    ]);
  });

  test("a matcher that throws gives EXTENSION_FAILED with its id", async () => {
    const { edit, fs } = await editWith([
      matcher(() => {
        throw new Error("boom");
      }),
    ]);
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "abc", newText: "x" }] });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "EXTENSION_FAILED",
      phase: "plan",
      data: { extension: "matchers", phase: "plan", id: "custom" },
    });
    expect(text(fs, "/f.ts")).toBe("abc abc\n");
  });

  test.each([
    ["not an array", () => ({})],
    ["an empty range", () => [{ start: 1, end: 1 }]],
    ["a range past the end", () => [{ start: 0, end: 99 }]],
    [
      "ranges out of order",
      () => [
        { start: 4, end: 7 },
        { start: 0, end: 3 },
      ],
    ],
    [
      "overlapping ranges",
      () => [
        { start: 0, end: 3 },
        { start: 2, end: 5 },
      ],
    ],
    ["a fractional offset", () => [{ start: 0.5, end: 3 }]],
    ["an unknown refusal", () => [{ start: 0, end: 3, refused: "nope" }]],
  ])("a malformed result (%s) gives EXTENSION_FAILED", async (_name, find) => {
    const { edit } = await editWith([matcher(find as never)]);
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "abc", newText: "x" }] });
    expect(errorOf(result)).toMatchObject({
      code: "EXTENSION_FAILED",
      data: { extension: "matchers" },
    });
  });

  test("more ranges than maxMatches are cut, not refused", async () => {
    const many = matcher((haystack, _needle, ctx) =>
      Array.from({ length: Math.min(ctx.maxMatches + 5, haystack.length) }, (_, index) => ({
        start: index,
        end: index + 1,
      })),
    );
    const { edit } = await editWith([many], "x".repeat(200));
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "x", newText: "y" }] });
    expect(errorOf(result)).toMatchObject({ code: "AMBIGUOUS_MATCH", data: { total: 200 } });
    expect(errorOf(result)?.data?.["lines"]).toHaveLength(10);
  });

  test("adapt that throws or returns a non-string gives EXTENSION_FAILED", async () => {
    const find: Matcher["find"] = (haystack, needle, ctx) =>
      exactMatcher().find(haystack, needle, ctx);
    for (const adapt of [
      () => {
        throw new Error("x");
      },
      () => 42 as never,
    ]) {
      const { edit } = await editWith([matcher(find, { adapt })]);
      const result = await edit({ path: "/f.ts", edits: [{ oldText: "abc abc", newText: "x" }] });
      expect(errorOf(result)).toMatchObject({ code: "EXTENSION_FAILED", data: { id: "custom" } });
    }
  });

  test("adapt gets the haystack, the needle, and the range", async () => {
    const seen: unknown[] = [];
    const find: Matcher["find"] = (haystack, needle, ctx) =>
      exactMatcher().find(haystack, needle, ctx);
    const { edit, fs } = await editWith([
      matcher(find, {
        adapt: (newText, hit) => {
          seen.push(hit);
          return newText.toUpperCase();
        },
      }),
    ]);
    await edit({ path: "/f.ts", edits: [{ oldText: "abc abc", newText: "xyz" }] });
    expect(seen).toEqual([
      { haystack: "abc abc\n", needle: "abc abc", range: { start: 0, end: 7 } },
    ]);
    expect(text(fs, "/f.ts")).toBe("XYZ\n");
  });

  test("a boundary refusal applies to any matcher, fuzzy or not", async () => {
    const { edit } = await editWith([matcher(() => [{ start: 0, end: 3, refused: "boundary" }])]);
    const result = await edit({ path: "/f.ts", edits: [{ oldText: "abc", newText: "x" }] });
    expect(errorOf(result)).toMatchObject({ code: "MATCH_REFUSED", data: { reason: "boundary" } });
  });

  test("span and escape guards apply to fuzzy matchers only", async () => {
    const wide = (haystack: string) => [{ start: 0, end: haystack.length }];
    const file = `${"x".repeat(100)}\n`;
    const exact = await editWith([matcher(wide)], file);
    expect(
      (await exact.edit({ path: "/f.ts", edits: [{ oldText: "x", newText: "\\n" }] })).status,
    ).toBe("ok");
    const fuzzy = await editWith([matcher(wide, { fuzzy: true })], file);
    const result = await fuzzy.edit({ path: "/f.ts", edits: [{ oldText: "x", newText: "y" }] });
    expect(errorOf(result)).toMatchObject({ code: "MATCH_REFUSED", data: { reason: "span" } });
  });

  test("more than 100 000 hits under replaceAll are refused", async () => {
    const { edit, fs } = await editWith([exactMatcher()], "x".repeat(100_001));
    const result = await edit({
      path: "/f.ts",
      edits: [{ oldText: "x", newText: "y", replaceAll: true }],
    });
    expect(errorOf(result)).toMatchObject({ code: "MATCH_REFUSED", data: { reason: "too-many" } });
    expect(text(fs, "/f.ts")).toBe("x".repeat(100_001));
  });
});

describe("guards on a hit", () => {
  test("tooWide: longer than twice the needle plus 64", () => {
    expect(tooWide({ start: 0, end: 84 }, "0123456789")).toBe(false);
    expect(tooWide({ start: 0, end: 85 }, "0123456789")).toBe(true);
  });

  test("escapeDrift: each sequence the new text adds and the region lacks", () => {
    expect(escapeDrift('say("a\\n")', 'say("a")')).toBe(true);
    expect(escapeDrift('say("a\\n")', 'say("b\\n")')).toBe(false);
    for (const sequence of ["\\t", '\\"', "\\'", "\\\\"]) {
      expect(escapeDrift(`x${sequence}`, "x")).toBe(true);
    }
    expect(escapeDrift("plain", "x")).toBe(false);
  });
});
