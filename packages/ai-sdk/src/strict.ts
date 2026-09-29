import type { JsonObject, JsonValue } from "@better-fs-tools/read";

const UNSUPPORTED_KEYWORDS = [
  "not",
  "if",
  "then",
  "else",
  "patternProperties",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
  "dependentSchemas",
  "dependentRequired",
  "dependencies",
  "prefixItems",
  "additionalItems",
  "contains",
] as const;

/** Keywords OpenAI strict mode supports. Others are dropped; the signature's parse still checks them. */
const STRICT_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "anyOf",
  "$ref",
  "$defs",
  "enum",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
]);

/** String formats OpenAI strict mode supports. */
const STRICT_FORMATS: ReadonlySet<string> = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "uuid",
]);

/**
 * Converts a signature schema to the JSON Schema subset OpenAI strict mode
 * accepts. Optional properties become required and nullable. Throws TypeError
 * naming the tool and schema path for a form strict mode cannot express.
 */
export function toStrictSchema(schema: JsonObject, tool: string): JsonObject {
  const root = structuredClone(schema) as JsonObject;
  const walk: Walk = { tool, root, renamesDefinitions: "definitions" in root };
  if (walk.renamesDefinitions && "$defs" in root)
    refuse(walk, "#/definitions", "both $defs and definitions");
  const strict = strictNode(root, walk, "#");
  if (strict.type !== "object" || "anyOf" in strict) {
    refuse(walk, "#", "a root schema that is not an object");
  }
  return deepFreeze(strict);
}

/** Turns each `null` that toStrictSchema allows for an optional property back into an absent key. */
export function fromStrictInput(schema: JsonObject, input: unknown): unknown {
  return restore(schema, input, schema);
}

interface Walk {
  readonly tool: string;
  readonly root: JsonObject;
  readonly renamesDefinitions: boolean;
}

function strictNode(input: JsonObject, walk: Walk, at: string): JsonObject {
  const schema = mergeAllOf(input, (form, where) => refuse(walk, `${at}${where}`, form));
  for (const key of UNSUPPORTED_KEYWORDS) {
    if (key in schema) refuse(walk, `${at}/${key}`, `the "${key}" keyword`);
  }
  if ("anyOf" in schema && "oneOf" in schema) refuse(walk, `${at}/oneOf`, "both anyOf and oneOf");
  if ("definitions" in schema && at !== "#") {
    refuse(walk, `${at}/definitions`, "definitions below the root");
  }
  const next: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (STRICT_KEYWORDS.has(key)) next[key] = value;
  }
  if (typeof schema.format === "string" && !STRICT_FORMATS.has(schema.format)) delete next.format;
  if ("const" in schema) next.enum = [schema.const!];
  const ref = schema.$ref;
  if (ref !== undefined) {
    if (typeof ref !== "string" || resolvePointer(ref, walk.root) === undefined) {
      refuse(walk, `${at}/$ref`, "a $ref that is not a local pointer into the schema");
    }
    if (walk.renamesDefinitions && ref.startsWith("#/definitions/")) {
      next.$ref = `#/$defs/${ref.slice("#/definitions/".length)}`;
    }
  }
  const definitions = schema.$defs ?? schema.definitions;
  if (definitions !== undefined) {
    const key = "$defs" in schema ? "$defs" : "definitions";
    if (!isObject(definitions)) refuse(walk, `${at}/${key}`, `a ${key} that is not an object`);
    const strict: Record<string, JsonValue> = {};
    for (const [name, child] of Object.entries(definitions)) {
      strict[name] = strictChild(child, walk, `${at}/${key}/${name}`);
    }
    next.$defs = strict;
  }
  const union = schema.anyOf ?? schema.oneOf;
  if (union !== undefined) {
    const key = "anyOf" in schema ? "anyOf" : "oneOf";
    if (!Array.isArray(union)) refuse(walk, `${at}/${key}`, `a ${key} that is not a list`);
    next.anyOf = union.map((child, index) => strictChild(child, walk, `${at}/${key}/${index}`));
  }
  if (!["type", "enum", "const", "anyOf", "oneOf", "$ref"].some((key) => key in schema)) {
    refuse(walk, at, "a schema with no type");
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
      const node = strictChild(child, walk, `${at}/properties/${key}`);
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

function strictChild(child: JsonValue, walk: Walk, at: string): JsonObject {
  if (!isObject(child)) refuse(walk, at, "a schema that is not an object");
  return strictNode(child, walk, at);
}

function mergeAllOf(schema: JsonObject, conflict: (form: string, at: string) => never): JsonObject {
  const allOf = schema.allOf;
  if (allOf === undefined) return schema;
  if (!Array.isArray(allOf)) conflict("an allOf that is not a list", "/allOf");
  const { allOf: _, ...merged } = schema as Record<string, JsonValue>;
  let objects = "properties" in merged ? 1 : 0;
  for (const [index, child] of allOf.entries()) {
    const at = `/allOf/${index}`;
    if (!isObject(child)) conflict("a schema that is not an object", at);
    if ("$ref" in child) conflict("a $ref inside allOf", `${at}/$ref`);
    const branch = mergeAllOf(child, (form, where) => conflict(form, `${at}${where}`));
    if ("properties" in branch && ++objects > 1) {
      conflict("an allOf over more than one object schema", "/allOf");
    }
    for (const [key, value] of Object.entries(branch)) {
      const current = merged[key];
      if (current === undefined) merged[key] = value;
      else if (key === "description") continue;
      else if (key === "required" && Array.isArray(current) && Array.isArray(value)) {
        merged[key] = [...new Set([...current, ...value])];
      } else if (JSON.stringify(current) !== JSON.stringify(value)) {
        conflict(`an allOf whose "${key}" differs from its schema`, `${at}/${key}`);
      }
    }
  }
  return merged;
}

function nullable(schema: JsonObject): JsonObject {
  const type = schema.type;
  const composed = "anyOf" in schema || "$ref" in schema;
  if (!composed && (typeof type === "string" || Array.isArray(type))) {
    const next: Record<string, JsonValue> = { ...schema };
    if (typeof type === "string") {
      if (type !== "null") next.type = [type, "null"];
    } else if (!type.includes("null")) {
      next.type = [...type, "null"];
    }
    const values = schema.enum;
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
  const node = mergedOrAsIs(resolveRef(schema, root));
  let value = input;
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = node[key];
    if (!Array.isArray(branches)) continue;
    const branch = findBranchFitting(branches, value, root);
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

function mergedOrAsIs(schema: JsonObject): JsonObject {
  try {
    return mergeAllOf(schema, (form) => {
      throw new TypeError(form);
    });
  } catch {
    return schema;
  }
}

function findBranchFitting(
  branches: readonly JsonValue[],
  value: unknown,
  root: JsonObject,
): JsonObject | undefined {
  const nodes = branches.filter(isObject).map((branch) => mergedOrAsIs(resolveRef(branch, root)));
  if (Array.isArray(value)) return nodes.find((node) => isObject(node.items));
  if (!isObject(value)) return undefined;
  const keys = Object.keys(value);
  return nodes.find((node) => {
    const properties = node.properties;
    return isObject(properties) && keys.every((key) => key in properties);
  });
}

const MAX_REF_HOPS = 32;

function resolveRef(schema: JsonObject, root: JsonObject): JsonObject {
  let node = schema;
  for (let hops = 0; hops < MAX_REF_HOPS && typeof node.$ref === "string"; hops++) {
    const target = resolvePointer(node.$ref, root);
    if (target === undefined) break;
    node = target;
  }
  return node;
}

function resolvePointer(ref: string, root: JsonObject): JsonObject | undefined {
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
