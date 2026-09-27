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
