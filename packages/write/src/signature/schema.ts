import type { JsonObject } from "@better-fs-tools/read";

/**
 * The read signature's path pattern, copied because it is internal to read.
 * Refuses an empty or blank path and any path that holds NUL. `\s` has the
 * same meaning in JSON Schema (ECMA-262) and in the checks below.
 */
// No lookaround: strict grammar engines may refuse one.
export const PATH_PATTERN = "^[^\\u0000]*[^\\s\\u0000][^\\u0000]*$";
const PATH_REGEX = new RegExp(PATH_PATTERN, "u");

/** A string with at least one non-whitespace character. The core refuses a blank patch. */
export const NON_BLANK_PATTERN = "^[\\s\\S]*\\S[\\s\\S]*$";
const NON_BLANK_REGEX = new RegExp(NON_BLANK_PATTERN, "u");

export function pathSchema(description: string): JsonObject {
  return { type: "string", minLength: 1, pattern: PATH_PATTERN, description };
}

/** `nonEmpty` adds minLength 1. */
export function stringSchema(description: string, nonEmpty = false): JsonObject {
  return nonEmpty ? { type: "string", minLength: 1, description } : { type: "string", description };
}

export function nonBlankSchema(description: string): JsonObject {
  return { type: "string", minLength: 1, pattern: NON_BLANK_PATTERN, description };
}

export function booleanSchema(description: string): JsonObject {
  return { type: "boolean", description };
}

/** An object schema with no extra keys. */
export function objectSchema(
  properties: readonly (readonly [string, JsonObject])[],
  required: readonly string[],
  description?: string,
): JsonObject {
  return {
    type: "object",
    ...(description === undefined ? {} : { description }),
    additionalProperties: false,
    properties: Object.fromEntries(properties),
    required: [...required],
  };
}

/**
 * The runtime twin of `objectSchema`. Returns the input as a record once every
 * key is known and every required key is present. Throws TypeError that names
 * the host parameters, each after `prefix`.
 */
export function readObject(
  input: unknown,
  label: string,
  keys: readonly string[],
  required: readonly string[],
  prefix = "",
): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object with ${keys.join(", ")}`);
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) {
      throw new TypeError(`Unknown ${label} key: ${key}. Expected ${keys.join(", ")}`);
    }
  }
  for (const key of required) {
    if (record[key] === undefined) throw new TypeError(`${prefix}${key} is required`);
  }
  return record;
}

export function readPath(value: unknown, name: string): string {
  if (typeof value !== "string" || !PATH_REGEX.test(value)) {
    throw new TypeError(`${name} must be a non-blank string without NUL`);
  }
  return value;
}

export function readString(value: unknown, name: string, nonEmpty = false): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  if (nonEmpty && value.length === 0) throw new TypeError(`${name} must not be empty`);
  return value;
}

export function readNonBlank(value: unknown, name: string): string {
  if (typeof value !== "string" || !NON_BLANK_REGEX.test(value)) {
    throw new TypeError(`${name} must be a non-blank string`);
  }
  return value;
}

/** A boolean, or undefined when absent. */
export function readFlag(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
  return value;
}

/** The checked docs options: the describe map and the final parameter names. */
export interface CheckedDocs<TParam extends string> {
  readonly describe: Partial<Record<TParam, string>>;
  readonly names: Readonly<Record<TParam, string>>;
}

/**
 * Checks the docs options every preset takes. `params` are the preset's own
 * parameter names. Returns the describe map and each parameter's final name,
 * after `names`. Throws TypeError on a blank or repeated name.
 */
export function checkDocs<TParam extends string>(
  options: unknown,
  label: string,
  params: readonly TParam[],
): CheckedDocs<TParam> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${label} options must be an object`);
  }
  const {
    name,
    description,
    describe = {},
    names = {},
  } = options as {
    name?: unknown;
    description?: unknown;
    describe?: unknown;
    names?: unknown;
  };
  if (name !== undefined && (typeof name !== "string" || name.trim() === "")) {
    throw new TypeError(`${label} name must be a non-blank string`);
  }
  if (description !== undefined && typeof description !== "string") {
    throw new TypeError(`${label} description must be a string`);
  }
  checkKeys(describe, "describe", label, params);
  checkKeys(names, "names", label, params);
  const resolved = {} as Record<TParam, string>;
  const seen = new Set<string>();
  for (const param of params) {
    const value = (names as Partial<Record<TParam, string>>)[param] ?? param;
    if (value.trim() === "") throw new TypeError(`names.${param} must be a non-blank string`);
    if (seen.has(value)) throw new TypeError(`Parameter name ${value} is used twice`);
    seen.add(value);
    resolved[param] = value;
  }
  return {
    describe: describe as Partial<Record<TParam, string>>,
    names: Object.freeze(resolved),
  };
}

function checkKeys(
  map: unknown,
  key: string,
  label: string,
  params: readonly string[],
): asserts map is Record<string, string> {
  if (map === null || typeof map !== "object" || Array.isArray(map)) {
    throw new TypeError(`${label} ${key} must be an object`);
  }
  for (const [param, value] of Object.entries(map)) {
    if (!params.includes(param)) {
      throw new TypeError(`Unknown parameter in ${key}: ${param}. Expected ${params.join(", ")}`);
    }
    if (typeof value !== "string") throw new TypeError(`${key}.${param} must be a string`);
  }
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
