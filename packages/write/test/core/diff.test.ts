import { describe, expect, test } from "bun:test";

import { unifiedDiff } from "../../src/core/diff.ts";

describe("unifiedDiff", () => {
  test("an update with context", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\n";
    const after = "a\nb\nc\nd\nE\nf\ng\nh\n";
    const diff = unifiedDiff(before, after, "/src/x.ts", 100);
    expect(diff).toEqual({
      linesAdded: 1,
      linesRemoved: 1,
      truncated: false,
      text: "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -2,7 +2,7 @@\n b\n c\n d\n-e\n+E\n f\n g\n h\n",
      changed: [[5, 5]],
    });
  });

  test("a create from /dev/null", () => {
    expect(unifiedDiff(null, "one\ntwo", "n.md", 100).text).toBe(
      "--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n",
    );
  });

  test("a changed final newline is a change", () => {
    const diff = unifiedDiff("a\nb", "a\nb\n", "f", 100);
    expect(diff.linesAdded).toBe(1);
    expect(diff.linesRemoved).toBe(1);
    expect(diff.text).toContain("-b\n\\ No newline at end of file\n+b\n");
  });

  test("far-apart changes get two hunks", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
    const changed = [...lines];
    changed[1] = "two";
    changed[27] = "twenty-eight";
    const diff = unifiedDiff(`${lines.join("\n")}\n`, `${changed.join("\n")}\n`, "f", 100);
    expect(diff.text.match(/^@@/gmu)?.length).toBe(2);
    expect(diff.text).toContain("@@ -1,5 +1,5 @@");
    expect(diff.text).toContain("@@ -25,6 +25,6 @@");
  });

  test("changed runs are line ranges in the new text", () => {
    const before = "a\nb\nc\nd\ne\nf\n";
    const after = "a\nB\nB2\nc\ne\nf\ng\n";
    expect(unifiedDiff(before, after, "f", 100).changed).toEqual([
      [2, 3],
      [5, 5],
      [7, 7],
    ]);
  });

  test("equal texts give an empty diff", () => {
    expect(unifiedDiff("a\n", "a\n", "f", 100)).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
      text: "",
      truncated: false,
      changed: [],
    });
  });

  test("cuts at maxLines and keeps exact counts", () => {
    const after = Array.from({ length: 50 }, (_, index) => `${index}`).join("\n");
    const diff = unifiedDiff(null, after, "f", 10);
    expect(diff.truncated).toBe(true);
    expect(diff.text.split("\n").filter(Boolean)).toHaveLength(10);
    expect(diff.linesAdded).toBe(50);
  });

  test("a minimal script for interleaved changes", () => {
    const diff = unifiedDiff("a\nb\nc\nd\n", "a\nx\nc\ny\nd\n", "f", 100);
    expect(diff.linesAdded).toBe(2);
    expect(diff.linesRemoved).toBe(1);
  });

  test("past the search bound the middle is replaced whole", () => {
    const before = Array.from({ length: 3_000 }, (_, index) => `a${index}`).join("\n");
    const after = Array.from({ length: 3_000 }, (_, index) => `b${index}`).join("\n");
    const diff = unifiedDiff(before, after, "f", 10);
    expect(diff.linesAdded).toBe(3_000);
    expect(diff.linesRemoved).toBe(3_000);
  });
});
