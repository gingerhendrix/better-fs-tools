import type { JsonObject } from "../contract/json.ts";

/**
 * Refuses an empty or blank path and any path that holds NUL, in the schema
 * itself, so a strict-mode provider never emits one. `\s` has the same meaning
 * in JSON Schema (ECMA-262) and in the check below.
 */
export const PATH_PATTERN = "^(?=[^\\u0000]*$)[\\s\\S]*[^\\s\\u0000][\\s\\S]*$";
const PATH_REGEX = new RegExp(PATH_PATTERN, "u");

export const DEFAULT_NAME = "read";

export function pathSchema(description: string): JsonObject {
  return { type: "string", minLength: 1, pattern: PATH_PATTERN, description };
}

export function lineSchema(description: string): JsonObject {
  return { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description };
}

/** An object schema with no extra keys. Only `path` is required. */
export function objectSchema(
  properties: readonly (readonly [string, JsonObject])[],
  path: string,
): JsonObject {
  return deepFreeze({
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(properties),
    required: [path],
  });
}

/**
 * The runtime twin of `objectSchema`. Returns the input as a record once every
 * key is known.
 * Throws TypeError that names the host parameters.
 */
export function readObject(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`Read input must be an object with ${list(keys)}`);
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) {
      throw new TypeError(`Unknown read input key: ${key}. Expected ${list(keys)}`);
    }
  }
  return record;
}

export function readPath(value: unknown, name: string): string {
  if (value === undefined) throw new TypeError(`${name} is required`);
  if (typeof value !== "string" || !PATH_REGEX.test(value)) {
    throw new TypeError(`${name} must be a non-blank string without NUL`);
  }
  return value;
}

/** A positive safe integer, or undefined when absent. */
export function readLine(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

/** Host names for each canonical parameter. Throws TypeError on a blank or repeated name. */
export function resolveNames<TParam extends string>(
  params: readonly TParam[],
  names: Partial<Record<TParam, string>> = {},
): Readonly<Record<TParam, string>> {
  if (names === null || typeof names !== "object" || Array.isArray(names)) {
    throw new TypeError("names must be an object");
  }
  const resolved = {} as Record<TParam, string>;
  const seen = new Set<string>();
  for (const key of Object.keys(names)) {
    if (!(params as readonly string[]).includes(key)) {
      throw new TypeError(`Unknown parameter in names: ${key}. Expected ${list(params)}`);
    }
  }
  for (const param of params) {
    const name = names[param] ?? param;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new TypeError(`names.${param} must be a non-blank string`);
    }
    if (seen.has(name)) throw new TypeError(`Parameter name ${name} is used twice`);
    seen.add(name);
    resolved[param] = name;
  }
  return Object.freeze(resolved);
}

function list(keys: readonly string[]): string {
  return keys.join(", ");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
