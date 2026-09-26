import { describe, expect, test } from "bun:test";

import { charsPerToken } from "../../src/index.ts";
import { expectOk, harness, lineText, note } from "../helpers.ts";

describe("charsPerToken", () => {
  test("measure is ceil(length / ratio) + 1 for the newline", () => {
    const budget = charsPerToken({ ratio: 4, max: 100 });
    expect(budget.id).toBe("chars-per-token");
    expect(budget.max).toBe(100);
    expect(budget.measure("")).toBe(1);
    expect(budget.measure("abcd")).toBe(2);
    expect(budget.measure("abcde")).toBe(3);
  });

  test("stops a read at a line boundary with a continuation", async () => {
    const text = `${"a".repeat(8)}\n${"b".repeat(8)}\n${"c".repeat(8)}\n`;
    const { read } = harness({
      files: { "/a.txt": text },
      deps: { budget: charsPerToken({ ratio: 4, max: 6 }) },
    });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(lineText(result)).toEqual(["a".repeat(8), "b".repeat(8)]);
    expect(result.truncation.primary).toBe("budget");
    expect(note(result, "continue")?.retry).toEqual({ path: "/a.txt", offset: 3, limit: 2_000 });
  });

  test("a ratio or max that is not a positive number throws TypeError", () => {
    for (const options of [
      { ratio: 0, max: 1 },
      { ratio: -1, max: 1 },
      { ratio: Number.NaN, max: 1 },
      { ratio: 4, max: 0 },
      { ratio: 4, max: Number.POSITIVE_INFINITY },
      { ratio: "4", max: 1 },
    ]) {
      expect(() => charsPerToken(options as never)).toThrow(TypeError);
    }
  });
});
