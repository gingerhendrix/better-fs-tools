import type { ReadRequest } from "../contract/input.ts";
import type { ReadLimits } from "../contract/limits.ts";

const KEYS: ReadonlySet<string> = new Set(["path", "offset", "limit"]);

/**
 * Strict validation. Throws TypeError on:
 * - a non-object, or any key other than path, offset, limit;
 * - a path that is not a string, is empty or only whitespace, or holds NUL;
 * - an offset or limit that is not a positive safe integer.
 * Clamps `limit` to `limits.maxLines`; the tool adds a clamped note.
 */
export function parseReadInput(input: unknown, limits: Readonly<ReadLimits>): ReadRequest {
  if (!isRecord(input)) throw new TypeError("Read input must be an object");
  for (const key of Object.keys(input)) {
    if (!KEYS.has(key)) throw new TypeError(`Unknown read input key: ${key}`);
  }
  const path = validatePath(input.path);
  const offset = input.offset === undefined ? 1 : validateInteger(input.offset, "offset");
  const limit =
    input.limit === undefined
      ? limits.maxLines
      : Math.min(validateInteger(input.limit, "limit"), limits.maxLines);
  return {
    path,
    offset,
    limit,
    ranged: input.offset !== undefined || input.limit !== undefined,
  };
}

function validatePath(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new TypeError("path must be a non-empty string without NUL");
  }
  return value;
}

function validateInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

/** The requested limit when parse clamped it, else null. `input` passed parseReadInput. */
export function clampedLimit(input: unknown, request: ReadRequest): number | null {
  if (!isRecord(input) || typeof input.limit !== "number") return null;
  return input.limit > request.limit ? input.limit : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
