import { describe, expect, test } from "bun:test";

import { defaultLimits, resolveLimits } from "../../src/index.ts";

describe("resolveLimits", () => {
  test("merges over defaults and may raise a limit", () => {
    const limits = resolveLimits({ maxLines: 10_000 });
    expect(limits.maxLines).toBe(10_000);
    expect(limits.maxViewBytes).toBe(defaultLimits.maxViewBytes);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  test("has the plan keys and defaults so far", () => {
    expect(defaultLimits).toEqual({
      maxLines: 2_000,
      maxViewBytes: 128 * 1_024,
      maxCharsPerLine: 2_000,
      maxScanBytes: 64 * 1_024 * 1_024,
      sampleBytes: 8_192,
      maxDirectoryEntries: 200,
      maxSuggestions: 5,
    });
  });

  test("clamps a sample larger than the scan to the scan", () => {
    expect(resolveLimits({ maxScanBytes: 64, sampleBytes: 4_096 }).sampleBytes).toBe(64);
  });

  test("rejects non-positive, fractional, and unknown values", () => {
    expect(() => resolveLimits({ maxLines: 0 })).toThrow(TypeError);
    expect(() => resolveLimits({ maxLines: 1.5 })).toThrow(TypeError);
    expect(() => resolveLimits({ nope: 1 } as never)).toThrow(TypeError);
    expect(() => resolveLimits({ maxConvertBytes: 5 } as never)).toThrow(
      "Unknown read limit: maxConvertBytes",
    );
    expect(() => resolveLimits(null as never)).toThrow(TypeError);
  });
});
