import { describe, expect, test } from "bun:test";

import { defaultWriteLimits, resolveWriteLimits } from "../../src/index.ts";

describe("resolveWriteLimits", () => {
  test("defaults", () => {
    expect(resolveWriteLimits()).toEqual(defaultWriteLimits);
    expect(defaultWriteLimits.maxFileBytes).toBe(8 * 1_024 * 1_024);
    expect(defaultWriteLimits.maxPatchBytes).toBe(4_194_304);
    expect(Object.isFrozen(defaultWriteLimits)).toBe(true);
  });

  test("merges key by key", () => {
    const limits = resolveWriteLimits({ maxEdits: 3 });
    expect(limits.maxEdits).toBe(3);
    expect(limits.maxWriteBytes).toBe(defaultWriteLimits.maxWriteBytes);
  });

  test("rejects unknown keys and bad values", () => {
    expect(() => resolveWriteLimits({ maxLines: 1 } as never)).toThrow("Unknown write limit");
    expect(() => resolveWriteLimits({ maxEdits: 0 })).toThrow(TypeError);
    expect(() => resolveWriteLimits({ maxEdits: 1.5 })).toThrow(TypeError);
    expect(() => resolveWriteLimits(null as never)).toThrow(TypeError);
  });

  test("lowers the default sample to a load cap you set", () => {
    expect(resolveWriteLimits({ maxFileBytes: 10 }).sampleBytes).toBe(10);
  });

  test("throws on a sample you set above the load cap", () => {
    expect(() => resolveWriteLimits({ maxFileBytes: 10, sampleBytes: 11 })).toThrow(
      "sampleBytes must not be more than maxFileBytes",
    );
    expect(resolveWriteLimits({ maxFileBytes: 10, sampleBytes: 10 }).sampleBytes).toBe(10);
  });
});
