import { describe, expect, test } from "bun:test";

import { describeWrite, keepFileLines } from "../../src/matchers/keep-bytes.ts";

describe("keepFileLines", () => {
  test("unchanged leading and trailing lines come from the file", () => {
    expect(keepFileLines(["A ", "x", "B "], ["A ", "x", "B "], ["A ", "y", "B "], true)).toEqual([
      "A ",
      "y",
      "B ",
    ]);
  });

  test("without keepUnchanged every line is written as given", () => {
    expect(keepFileLines(["A "], ["A "], ["A "], false)).toEqual(["A "]);
  });

  test("replaced lines take the CR of the file line at the same place", () => {
    expect(keepFileLines(["a\r", "b", "c\r"], ["a", "b", "c"], ["1", "2", "3", "4"], true)).toEqual(
      ["1\r", "2", "3\r", "4\r"],
    );
  });

  test("with no kept line after it, the last new line pairs with the last replaced line", () => {
    expect(keepFileLines(["a\r", "b"], ["a", "b"], ["x"], true)).toEqual(["x"]);
    expect(keepFileLines(["a\r", "b"], ["a", "b"], ["x", "b"], true)).toEqual(["x\r", "b"]);
  });

  test("a new line that already ends with CR, and an insertion with nothing replaced, stay as given", () => {
    expect(keepFileLines(["a\r"], ["a"], ["x\r"], true)).toEqual(["x\r"]);
    expect(keepFileLines([], [], ["x"], true)).toEqual(["x"]);
  });
});

describe("describeWrite", () => {
  test("a line that only gained the file's CR kept the line end", () => {
    expect(describeWrite(["old\r", "line"], ["new", "line"], ["new\r", "line"])).toEqual({
      keptLines: 0,
      keptLineEnds: 1,
      adaptedLines: 0,
    });
  });

  test("a line taken from the file kept its characters, even with a CR", () => {
    expect(describeWrite(["A\u2212B\r", "x"], ["A-B", "y"], ["A\u2212B\r", "y"])).toEqual({
      keptLines: 1,
      keptLineEnds: 0,
      adaptedLines: 0,
    });
  });

  test("other changes are the matcher's, and lines as given count for nothing", () => {
    expect(describeWrite(["  a"], ["a", "b"], ["  a", "  b"])).toEqual({
      keptLines: 1,
      keptLineEnds: 0,
      adaptedLines: 1,
    });
    expect(describeWrite(["a"], ["a"], ["a"])).toEqual({
      keptLines: 0,
      keptLineEnds: 0,
      adaptedLines: 0,
    });
    expect(describeWrite(["a"], ["a", "b"], ["a"]).adaptedLines).toBe(1);
  });
});
