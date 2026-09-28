import { describe, expect, test } from "bun:test";

describe("package entries", () => {
  test("the root, ./patch, and ./signature entries load", async () => {
    for (const specifier of [
      "@better-fs-tools/write",
      "@better-fs-tools/write/patch",
      "@better-fs-tools/write/signature",
    ]) {
      expect(await import(specifier)).toBeDefined();
    }
  });
});

describe("./patch", () => {
  test("exports the parser, and the root exports the same functions", async () => {
    const patch = await import("@better-fs-tools/write/patch");
    const root = await import("@better-fs-tools/write");
    expect(Object.keys(patch).sort()).toEqual(["codexPatchParser", "parsePatch"]);
    expect(root.parsePatch).toBe(patch.parsePatch);
    expect(root.codexPatchParser).toBe(patch.codexPatchParser);
  });
});
