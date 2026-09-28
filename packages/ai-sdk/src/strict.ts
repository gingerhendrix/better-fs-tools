import type { JsonObject, JsonValue } from "@better-fs-tools/read";

/**
 * The provider schema for a strict tool. OpenAI strict mode needs every
 * property in `required` and `additionalProperties: false` on every object.
 * A property the signature leaves optional becomes required and nullable, so
 * the model sends `null` for "absent". `fromStrictInput` maps it back.
 * Recurses into properties and array items. Returns a frozen copy.
 */
export function toStrictSchema(schema: JsonObject): JsonObject {
  return deepFreeze(strictNode(schema));
}

/**
 * Drops each `null` that stands for an optional property the signature left
 * out of `required`, at every level `toStrictSchema` changed. Other values
 * pass through, so the signature's own parse still refuses a bad `null`.
 */
export function fromStrictInput(schema: JsonObject, input: unknown): unknown {
  if (Array.isArray(input)) {
    const items = schema.items;
    return isObject(items) ? input.map((item) => fromStrictInput(items, item)) : input;
  }
  if (!isObject(input)) return input;
  const properties = schema.properties;
  if (!isObject(properties)) return input;
  const required = requiredOf(schema);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const child = properties[key];
    if (value === null && isObject(child) && !required.includes(key)) continue;
    output[key] = isObject(child) ? fromStrictInput(child, value) : value;
  }
  return output;
}

function strictNode(schema: JsonObject): JsonObject {
  const next: Record<string, JsonValue> = { ...schema };
  const items = schema.items;
  if (isObject(items)) next.items = strictNode(items);
  const properties = schema.properties;
  if (isObject(properties)) {
    const required = requiredOf(schema);
    const strict: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(properties)) {
      if (!isObject(child)) {
        strict[key] = child;
        continue;
      }
      const node = strictNode(child);
      strict[key] = required.includes(key) ? node : nullable(node);
    }
    next.properties = strict;
    next.required = Object.keys(properties);
    next.additionalProperties = false;
  }
  return next;
}

/** Adds null to `type`, or wraps a schema with no `type` in `anyOf`. */
function nullable(schema: JsonObject): JsonObject {
  const type = schema.type;
  if (typeof type === "string") {
    return type === "null" ? schema : { ...schema, type: [type, "null"] };
  }
  if (Array.isArray(type)) {
    return type.includes("null") ? schema : { ...schema, type: [...type, "null"] };
  }
  const { description, ...rest } = schema;
  return {
    ...(description === undefined ? {} : { description }),
    anyOf: [rest, { type: "null" }],
  };
}

function requiredOf(schema: JsonObject): readonly string[] {
  const required = schema.required;
  return Array.isArray(required)
    ? required.filter((key): key is string => typeof key === "string")
    : [];
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
