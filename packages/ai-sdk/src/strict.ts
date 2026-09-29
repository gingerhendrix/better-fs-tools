import type { JsonObject, JsonValue } from "@better-fs-tools/read";

/** Keywords that hold a schema strict mode cannot express. */
const UNSUPPORTED = [
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
  "dependentSchemas",
  "dependencies",
  "prefixItems",
  "additionalItems",
  "contains",
] as const;

/** Keywords whose value is a map of named schemas. */
const DEFINITIONS = ["$defs", "definitions"] as const;

/** Keywords whose value is a list of schemas. */
const COMPOSITIONS = ["anyOf", "oneOf", "allOf"] as const;

/**
 * The provider schema for a strict tool. OpenAI strict mode needs every
 * property in `required` and `additionalProperties: false` on every object.
 * A property the signature leaves optional becomes required and nullable, so
 * the model sends `null` for "absent". `fromStrictInput` maps it back.
 * Nullable adds `null` to `type` and to `enum`, and turns `const` into an enum
 * with `null`. A schema with no `type`, or one with `anyOf`, `oneOf`, or
 * `allOf`, is wrapped in `anyOf` with `{ type: "null" }` instead.
 *
 * Walks properties, array items, anyOf, oneOf, allOf, $defs, and definitions.
 * A local `$ref` stays as it is; its target is converted where it is defined.
 * Returns a frozen copy and leaves `schema` unchanged.
 *
 * Throws TypeError that names `tool` and the schema path for a form strict
 * mode cannot express: an open object, a keyword such as `not` or
 * `patternProperties`, tuple items, `allOf` over more than one object schema,
 * or a `$ref` that is not a local pointer into the schema.
 */
export function toStrictSchema(schema: JsonObject, tool: string): JsonObject {
  const root = structuredClone(schema) as JsonObject;
  return deepFreeze(strictNode(root, { tool, root }, "#"));
}

/**
 * Drops each `null` that stands for an optional property the signature left
 * out of `required`, at every level `toStrictSchema` changed. Follows local
 * `$ref`s, applies each `allOf` branch, and picks the `anyOf` or `oneOf` branch
 * whose properties hold every key of the input. Other values pass through, so
 * the signature's own parse still refuses a bad `null`.
 */
export function fromStrictInput(schema: JsonObject, input: unknown): unknown {
  return restore(schema, input, schema);
}

interface Walk {
  readonly tool: string;
  readonly root: JsonObject;
}

function strictNode(schema: JsonObject, walk: Walk, at: string): JsonObject {
  for (const key of UNSUPPORTED) {
    if (key in schema) refuse(walk, `${at}/${key}`, `the "${key}" keyword`);
  }
  const next: Record<string, JsonValue> = { ...schema };
  const ref = schema.$ref;
  if (ref !== undefined) {
    if (typeof ref !== "string" || lookup(ref, walk.root) === undefined) {
      refuse(walk, `${at}/$ref`, "a $ref that is not a local pointer into the schema");
    }
  }
  for (const key of DEFINITIONS) {
    const definitions = schema[key];
    if (definitions === undefined) continue;
    if (!isObject(definitions)) refuse(walk, `${at}/${key}`, `a ${key} that is not an object`);
    const strict: Record<string, JsonValue> = {};
    for (const [name, child] of Object.entries(definitions)) {
      strict[name] = isObject(child) ? strictNode(child, walk, `${at}/${key}/${name}`) : child;
    }
    next[key] = strict;
  }
  for (const key of COMPOSITIONS) {
    const branches = schema[key];
    if (branches === undefined) continue;
    if (!Array.isArray(branches)) refuse(walk, `${at}/${key}`, `a ${key} that is not a list`);
    next[key] = branches.map((child, index) =>
      isObject(child) ? strictNode(child, walk, `${at}/${key}/${index}`) : child,
    );
  }
  const allOf = schema.allOf;
  if (Array.isArray(allOf)) {
    const objects = [schema, ...allOf].filter((child) => isObject(child) && "properties" in child);
    if (objects.length > 1) {
      refuse(walk, `${at}/allOf`, "an allOf over more than one object schema");
    }
  }
  const items = schema.items;
  if (items !== undefined) {
    if (!isObject(items)) refuse(walk, `${at}/items`, "tuple items");
    next.items = strictNode(items, walk, `${at}/items`);
  }
  const properties = schema.properties;
  const open = schema.additionalProperties;
  if (properties !== undefined) {
    if (!isObject(properties))
      refuse(walk, `${at}/properties`, "properties that are not an object");
    if (open !== undefined && open !== false) {
      refuse(walk, `${at}/additionalProperties`, "an object that allows other properties");
    }
    const required = requiredOf(schema);
    const strict: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(properties)) {
      if (!isObject(child)) {
        strict[key] = child;
        continue;
      }
      const node = strictNode(child, walk, `${at}/properties/${key}`);
      strict[key] = required.includes(key) ? node : nullable(node);
    }
    next.properties = strict;
    next.required = Object.keys(properties);
    next.additionalProperties = false;
  } else if (typeIncludes(schema, "object") && open !== false) {
    refuse(walk, at, "an object with no properties that allows other properties");
  }
  return next;
}

/**
 * Adds null to `type`, `enum`, and `const`, or wraps a schema with no `type`,
 * or with a composition, in `anyOf` with null.
 */
function nullable(schema: JsonObject): JsonObject {
  const type = schema.type;
  const composed = COMPOSITIONS.some((key) => key in schema) || "$ref" in schema;
  if (!composed && (typeof type === "string" || Array.isArray(type))) {
    const { const: constant, ...rest } = schema;
    const next: Record<string, JsonValue> = { ...rest };
    if (typeof type === "string") {
      if (type !== "null") next.type = [type, "null"];
    } else if (!type.includes("null")) {
      next.type = [...type, "null"];
    }
    const values = constant === undefined ? schema.enum : [constant];
    if (Array.isArray(values)) next.enum = values.includes(null) ? values : [...values, null];
    return next;
  }
  const { description, ...rest } = schema;
  return {
    ...(description === undefined ? {} : { description }),
    anyOf: [rest, { type: "null" }],
  };
}

function restore(schema: JsonObject, input: unknown, root: JsonObject): unknown {
  const node = follow(schema, root);
  let value = input;
  const allOf = node.allOf;
  if (Array.isArray(allOf)) {
    for (const branch of allOf) if (isObject(branch)) value = restore(branch, value, root);
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = node[key];
    if (!Array.isArray(branches)) continue;
    const branch = pick(branches, value, root);
    if (branch !== undefined) value = restore(branch, value, root);
  }
  if (Array.isArray(value)) {
    const items = node.items;
    return isObject(items) ? value.map((item) => restore(items, item, root)) : value;
  }
  if (!isObject(value)) return value;
  const properties = node.properties;
  if (!isObject(properties)) return value;
  const required = requiredOf(node);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const property = properties[key];
    if (child === null && isObject(property) && !required.includes(key)) continue;
    output[key] = isObject(property) ? restore(property, child, root) : child;
  }
  return output;
}

/** The branch an input came from: the first one whose shape fits it. */
function pick(
  branches: readonly JsonValue[],
  value: unknown,
  root: JsonObject,
): JsonObject | undefined {
  const nodes = branches.filter(isObject).map((branch) => follow(branch, root));
  if (Array.isArray(value)) return nodes.find((node) => isObject(node.items));
  if (!isObject(value)) return undefined;
  const keys = Object.keys(value);
  return nodes.find((node) => {
    const properties = node.properties;
    return isObject(properties) && keys.every((key) => key in properties);
  });
}

/** Follows `$ref` to its target, at most 32 times. */
function follow(schema: JsonObject, root: JsonObject): JsonObject {
  let node = schema;
  for (let hops = 0; hops < 32 && typeof node.$ref === "string"; hops++) {
    const target = lookup(node.$ref, root);
    if (target === undefined) break;
    node = target;
  }
  return node;
}

/** The schema a local JSON pointer such as `#/$defs/Edit` names. */
function lookup(ref: string, root: JsonObject): JsonObject | undefined {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let node: JsonValue = root;
  for (const part of ref.slice(2).split("/")) {
    const key = decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(node) || !(key in node)) return undefined;
    node = node[key]!;
  }
  return isObject(node) ? node : undefined;
}

function refuse(walk: Walk, at: string, form: string): never {
  throw new TypeError(`${walk.tool}: strict mode cannot express ${form} at ${at}`);
}

function typeIncludes(schema: JsonObject, name: string): boolean {
  const type = schema.type;
  return type === name || (Array.isArray(type) && type.includes(name));
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
