import { describe, expect, test } from "bun:test";

import { canonicalizeFileName } from "../../src/index.ts";

describe("canonicalizeFileName", () => {
  // The pairs differ only in invisible ways: NFD versus NFC, and a narrow or
  // non-breaking space versus U+0020. The escapes keep the real characters.
  test("folds NFD, narrow and non-breaking spaces, and typographic quotes", () => {
    expect(canonicalizeFileName("café.txt")).toBe(canonicalizeFileName("café.txt"));
    expect(canonicalizeFileName("a b.txt")).toBe("a b.txt");
    expect(canonicalizeFileName("report 2026.txt")).toBe("report 2026.txt");
    expect(canonicalizeFileName("it’s.txt")).toBe("it's.txt");
    expect(canonicalizeFileName("“q”.txt")).toBe('"q".txt');
  });
});
