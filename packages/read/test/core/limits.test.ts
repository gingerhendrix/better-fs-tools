import { describe, expect, test } from "bun:test";

import { defaultReadLimits, resolveReadLimits } from "../../src/index.ts";

describe("resolveReadLimits", () => {
  test("merges over defaults and may raise a limit", () => {
    const limits = resolveReadLimits({ maxLines: 10_000 });
    expect(limits.maxLines).toBe(10_000);
    expect(limits.maxViewBytes).toBe(defaultReadLimits.maxViewBytes);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  test("has the plan keys and defaults", () => {
    expect(defaultReadLimits).toEqual({
      maxLines: 2_000,
      maxViewBytes: 50 * 1_024,
      maxCharsPerLine: 2_000,
      maxScanBytes: 64 * 1_024 * 1_024,
      sampleBytes: 8_192,
      maxDirectoryEntries: 200,
      maxSuggestions: 5,
      maxConvertBytes: 64 * 1_024 * 1_024,
      maxMediaBytes: 5 * 1_024 * 1_024,
    });
  });

  test("throws on a sample you set above the scan limit", () => {
    expect(() => resolveReadLimits({ maxScanBytes: 64, sampleBytes: 4_096 })).toThrow(
      "sampleBytes must not be more than maxScanBytes",
    );
    expect(() => resolveReadLimits({ maxScanBytes: 64, sampleBytes: 65 })).toThrow(TypeError);
    expect(resolveReadLimits({ maxScanBytes: 64, sampleBytes: 64 }).sampleBytes).toBe(64);
  });

  test("lowers the default sample to a scan limit you set", () => {
    expect(resolveReadLimits({ maxScanBytes: 64 }).sampleBytes).toBe(64);
  });

  test("rejects non-positive, fractional, and unknown values", () => {
    expect(() => resolveReadLimits({ maxLines: 0 })).toThrow(TypeError);
    expect(() => resolveReadLimits({ maxLines: 1.5 })).toThrow(TypeError);
    expect(() => resolveReadLimits({ nope: 1 } as never)).toThrow(TypeError);
    expect(() => resolveReadLimits({ maxConvertBytes: 0 })).toThrow(TypeError);
    expect(() => resolveReadLimits({ maxBudget: 5 } as never)).toThrow(
      "Unknown read limit: maxBudget",
    );
    expect(() => resolveReadLimits(null as never)).toThrow(TypeError);
  });
});
