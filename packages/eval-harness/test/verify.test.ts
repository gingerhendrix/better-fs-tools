import { describe, expect, test } from "bun:test";

import { compareFile } from "../src/verify.ts";

const expected = "export function f(a: number) {\n  return a + 1;\n}\n";

describe("compareFile", () => {
  test("passes on identical text", async () => {
    expect((await compareFile("x.ts", expected, expected)).passed).toBe(true);
  });

  test("ignores indentation and extra blank lines, as the Oh My Pi verifier does", async () => {
    const actual = "export function f(a: number) {\n\n\n      return a + 1;\n}\n";
    expect((await compareFile("x.ts", expected, actual)).passed).toBe(true);
  });

  test("fails on a content change and counts changed lines", async () => {
    const result = await compareFile("x.ts", expected, expected.replace("+ 1", "- 1"));
    expect(result.passed).toBe(false);
    expect(result.error).toBe("file mismatch: x.ts");
    expect(result.linesChanged).toBe(2);
  });
});
