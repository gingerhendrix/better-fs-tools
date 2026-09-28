import type { ShellLimits } from "../contract/limits.ts";

/** Defaults, not ceilings. A host may raise any of these. */
export const defaultShellLimits: Readonly<ShellLimits> = Object.freeze({
  defaultTimeoutMs: 120_000,
  maxTimeoutMs: 600_000,
  killGraceMs: 2_000,
  maxOutputBytes: 30_000,
  maxOutputLines: 2_000,
  headPercent: 20,
  maxCaptureBytes: 10 * 1_024 * 1_024,
});

const LIMIT_KEYS = Object.keys(defaultShellLimits) as (keyof ShellLimits)[];

/**
 * Merges key by key. Throws TypeError on an unknown key, on a value that is
 * not a positive safe integer, on a headPercent over 100, or on a default
 * timeout over the maximum.
 */
export function resolveShellLimits(overrides: Partial<ShellLimits> = {}): Readonly<ShellLimits> {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("limits must be an object");
  }
  const unknown = Object.keys(overrides).find((key) => !Object.hasOwn(defaultShellLimits, key));
  if (unknown !== undefined) throw new TypeError(`Unknown shell limit: ${unknown}`);

  const resolved: { -readonly [K in keyof ShellLimits]: number } = { ...defaultShellLimits };
  for (const key of LIMIT_KEYS) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${key} must be a positive safe integer`);
    }
    resolved[key] = value;
  }
  if (resolved.headPercent > 100) throw new TypeError("headPercent must be 100 or less");
  if (resolved.defaultTimeoutMs > resolved.maxTimeoutMs) {
    throw new TypeError("defaultTimeoutMs must not be more than maxTimeoutMs");
  }
  return Object.freeze(resolved);
}
