import { describe, expect, test } from "bun:test";

import { coversLines, joinLineRanges, storedLineRanges } from "../../src/core/seen-lines.ts";

describe("joinLineRanges", () => {
  test("sorts and joins ranges that overlap or touch", () => {
    expect(
      joinLineRanges([
        { start: 28, end: 47 },
        { start: 1, end: 30 },
        { start: 50, end: 60 },
        { start: 61, end: 61 },
      ]),
    ).toEqual([
      { start: 1, end: 47 },
      { start: 50, end: 61 },
    ]);
  });

  test("keeps a range that another range contains as one range", () => {
    expect(
      joinLineRanges([
        { start: 1, end: 10 },
        { start: 3, end: 4 },
      ]),
    ).toEqual([{ start: 1, end: 10 }]);
  });
});

describe("coversLines", () => {
  test("is true only when one joined range runs from line 1 to the last line", () => {
    expect(coversLines([{ start: 1, end: 35 }], 35)).toBe(true);
    expect(coversLines([{ start: 1, end: 34 }], 35)).toBe(false);
    expect(coversLines([{ start: 2, end: 35 }], 35)).toBe(false);
    expect(
      coversLines(
        [
          { start: 1, end: 10 },
          { start: 12, end: 35 },
        ],
        35,
      ),
    ).toBe(false);
  });

  test("an empty file is covered", () => {
    expect(coversLines([], 0)).toBe(true);
  });
});

describe("storedLineRanges", () => {
  test("returns valid ranges", () => {
    expect(storedLineRanges([{ start: 1, end: 2 }])).toEqual([{ start: 1, end: 2 }]);
  });

  test("treats a missing or malformed value as no range", () => {
    expect(storedLineRanges(undefined)).toEqual([]);
    expect(storedLineRanges([{ start: 0, end: 2 }])).toEqual([]);
    expect(storedLineRanges([{ start: 3, end: 2 }])).toEqual([]);
    expect(storedLineRanges([{ start: 1, end: "2" }])).toEqual([]);
    expect(storedLineRanges([null])).toEqual([]);
  });
});
