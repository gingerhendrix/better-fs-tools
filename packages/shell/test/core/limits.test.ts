import { describe, expect, test } from "bun:test";

import { defaultShellLimits, resolveShellLimits } from "@better-fs-tools/shell";

describe("resolveShellLimits", () => {
  test("lowers the default timeout to a maximum you set", () => {
    const limits = resolveShellLimits({ maxTimeoutMs: 1_000 });
    expect(limits.defaultTimeoutMs).toBe(1_000);
    expect(limits.maxTimeoutMs).toBe(1_000);
  });

  test("throws on a default timeout you set above the maximum", () => {
    expect(() => resolveShellLimits({ defaultTimeoutMs: 700_000 })).toThrow(
      "defaultTimeoutMs must not be more than maxTimeoutMs",
    );
    expect(() => resolveShellLimits({ defaultTimeoutMs: 2_000, maxTimeoutMs: 1_000 })).toThrow(
      TypeError,
    );
  });

  test("throws on a head percent over 100", () => {
    expect(() => resolveShellLimits({ headPercent: 101 })).toThrow(TypeError);
  });

  test("keeps the defaults when nothing conflicts", () => {
    expect(resolveShellLimits()).toEqual(defaultShellLimits);
  });
});
