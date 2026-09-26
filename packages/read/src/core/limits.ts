import type { ReadLimits } from "../contract/limits.ts";

/**
 * Defaults, not package ceilings. A host may raise any of these. A supplied
 * value must be a positive safe integer.
 */
export const defaultLimits: Readonly<ReadLimits> = Object.freeze({
  maxLines: 2_000,
  maxViewBytes: 128 * 1_024,
  maxCharsPerLine: 2_000,
  maxScanBytes: 64 * 1_024 * 1_024,
  sampleBytes: 8_192,
  maxDirectoryEntries: 200,
  maxSuggestions: 5,
  maxConvertBytes: 64 * 1_024 * 1_024,
  maxMediaBytes: 5 * 1_024 * 1_024,
});

const LIMIT_KEYS = Object.keys(defaultLimits) as (keyof ReadLimits)[];

/** Merges key by key. Throws TypeError on an unknown key or a value that is not a positive safe integer. */
export function resolveLimits(overrides: Partial<ReadLimits> = {}): Readonly<ReadLimits> {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("limits must be an object");
  }
  const unknown = Object.keys(overrides).find((key) => !Object.hasOwn(defaultLimits, key));
  if (unknown !== undefined) throw new TypeError(`Unknown read limit: ${unknown}`);

  const resolved: { -readonly [K in keyof ReadLimits]: number } = { ...defaultLimits };
  for (const key of LIMIT_KEYS) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${key} must be a positive safe integer`);
    }
    resolved[key] = value;
  }
  // A sample larger than the scan is incoherent rather than unsafe.
  if (resolved.sampleBytes > resolved.maxScanBytes) resolved.sampleBytes = resolved.maxScanBytes;
  return Object.freeze(resolved);
}
