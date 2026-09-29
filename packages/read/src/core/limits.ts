import type { ReadLimits } from "../contract/limits.ts";

/** The default read limits. They are not ceilings: a host may raise any of them. */
export const defaultReadLimits: Readonly<ReadLimits> = Object.freeze({
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

const LIMIT_KEYS = Object.keys(defaultReadLimits) as (keyof ReadLimits)[];

/**
 * Merges overrides over `defaultReadLimits`. Throws TypeError on an unknown key,
 * a value that is not a positive safe integer, or a `sampleBytes` you set above
 * `maxScanBytes`. A default `sampleBytes` above your `maxScanBytes` is lowered to it.
 */
export function resolveReadLimits(overrides: Partial<ReadLimits> = {}): Readonly<ReadLimits> {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("limits must be an object");
  }
  const unknown = Object.keys(overrides).find((key) => !Object.hasOwn(defaultReadLimits, key));
  if (unknown !== undefined) throw new TypeError(`Unknown read limit: ${unknown}`);

  const resolved: { -readonly [K in keyof ReadLimits]: number } = { ...defaultReadLimits };
  for (const key of LIMIT_KEYS) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${key} must be a positive safe integer`);
    }
    resolved[key] = value;
  }
  if (resolved.sampleBytes > resolved.maxScanBytes) {
    if (overrides.sampleBytes !== undefined) {
      throw new TypeError("sampleBytes must not be more than maxScanBytes");
    }
    resolved.sampleBytes = resolved.maxScanBytes;
  }
  return Object.freeze(resolved);
}
