import { describe, expect, test } from "bun:test";

import {
  MissCounter,
  closestRegion,
  isAlreadyApplied,
  trailingNewline,
} from "../../src/core/hints.ts";

describe("failure help (section 5.5)", () => {
  test("trailing newline: the old text has a newline the file's end lacks", () => {
    expect(trailingNewline("a\nlast", "last\n")).toBe("extra");
    expect(trailingNewline("a\nlast\n", "last\n")).toBeNull();
    expect(trailingNewline("a\nlast", "other\n")).toBeNull();
    expect(trailingNewline("a\nlast", "last")).toBeNull();
    expect(trailingNewline("x", "\n")).toBeNull();
  });

  test("closest region: best window, one line around it, read-style numbers", () => {
    const file = "one\ntwo\nthree\nfour\nfive\nsix\n";
    expect(closestRegion(file, "three\nFOUR\nfive", 12)).toEqual({
      text: "2|two\n3|three\n4|four\n5|five\n6|six",
      lines: [2, 6],
    });
  });

  test("closest region: the first best window wins and blank lines do not score", () => {
    const file = "x\n\nmatch\n\nmatch\n";
    expect(closestRegion(file, "\nmatch", 12)?.lines).toEqual([1, 4]);
    expect(closestRegion("a\n\nb\n", "\n\n", 12)).toBeNull();
  });

  test("closest region: capped at maxHintLines, skipped past the work bound", () => {
    const file = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    const needle = Array.from({ length: 20 }, (_, index) => `line ${index + 10}`).join("\n");
    expect(closestRegion(file, needle, 5)?.lines).toEqual([10, 14]);
    const big = "x\n".repeat(2_001);
    expect(closestRegion(big, "x\n".repeat(1_000), 12)).toBeNull();
  });

  test("closest region: long lines are cut", () => {
    const long = "y".repeat(500);
    expect(closestRegion(`${long}\nkey\n`, "key", 12)?.text).toBe(`1|${"y".repeat(200)}…\n2|key`);
  });

  test("already applied: the new text is in the file exactly once", () => {
    expect(isAlreadyApplied("a\nnew\nb", "new")).toBe(true);
    expect(isAlreadyApplied("new new", "new")).toBe(false);
    expect(isAlreadyApplied("a", "")).toBe(false);
    expect(isAlreadyApplied("a", "b")).toBe(false);
  });

  test("miss counter: counts in a row, resets, and forgets the oldest path", () => {
    const misses = new MissCounter(2);
    expect([misses.miss("/a"), misses.miss("/a"), misses.miss("/a")]).toEqual([1, 2, 3]);
    misses.reset("/a");
    expect(misses.miss("/a")).toBe(1);
    misses.miss("/b");
    misses.miss("/a");
    misses.miss("/c");
    expect(misses.size).toBe(2);
    // /b was missed longest ago, so it went first.
    expect(misses.miss("/b")).toBe(1);
    expect(misses.miss("/a")).toBe(1);
  });

  test("miss counter: 256 paths by default", () => {
    const misses = new MissCounter();
    for (let index = 0; index < 300; index += 1) misses.miss(`/f${index}`);
    expect(misses.size).toBe(256);
  });
});
