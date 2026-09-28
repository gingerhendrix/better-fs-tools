import type { WriteLimits } from "../contract/limits.ts";

const MIB = 1_024 * 1_024;

/**
 * Defaults, not package ceilings. A host may raise any of these. A supplied
 * value must be a positive safe integer.
 */
export const defaultWriteLimits: Readonly<WriteLimits> = Object.freeze({
  maxFileBytes: 8 * MIB,
  maxWriteBytes: 8 * MIB,
  maxPatchBytes: 4 * MIB,
  maxPatchFiles: 100,
  maxEdits: 100,
  sampleBytes: 8_192,
  snippetLines: 3,
  maxSnippetLines: 40,
  maxDiffLines: 2_000,
  maxHintLines: 12,
  maxListedMatches: 10,
  maxPatchProblems: 20,
});

const LIMIT_KEYS = Object.keys(defaultWriteLimits) as (keyof WriteLimits)[];

/**
 * Merges key by key. Throws TypeError on an unknown key, a value that is not
 * a positive safe integer, or a `sampleBytes` you set above `maxFileBytes`.
 * A default `sampleBytes` over a `maxFileBytes` you set is lowered to it.
 */
export function resolveWriteLimits(overrides: Partial<WriteLimits> = {}): Readonly<WriteLimits> {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("limits must be an object");
  }
  const unknown = Object.keys(overrides).find((key) => !Object.hasOwn(defaultWriteLimits, key));
  if (unknown !== undefined) throw new TypeError(`Unknown write limit: ${unknown}`);

  const resolved: { -readonly [K in keyof WriteLimits]: number } = { ...defaultWriteLimits };
  for (const key of LIMIT_KEYS) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${key} must be a positive safe integer`);
    }
    resolved[key] = value;
  }
  if (resolved.sampleBytes > resolved.maxFileBytes) {
    if (overrides.sampleBytes !== undefined) {
      throw new TypeError("sampleBytes must not be more than maxFileBytes");
    }
    resolved.sampleBytes = resolved.maxFileBytes;
  }
  return Object.freeze(resolved);
}
