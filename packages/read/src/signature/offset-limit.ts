import type { ReadInput } from "../contract/input.ts";
import type { JsonObject } from "../contract/json.ts";
import type { DefaultModelInput, ReadParam, ReadSignature, SignatureDocs } from "./contract.ts";
import {
  DEFAULT_NAME,
  lineSchema,
  objectSchema,
  pathSchema,
  readLine,
  readObject,
  readPath,
  resolveNames,
} from "./schema.ts";

const PARAMS: readonly ReadParam[] = ["path", "offset", "limit"];

/** The default schema: integer offset and limit, NUL-free non-blank path. Identity mapping. */
export function defaultSignature(
  options: SignatureDocs<ReadParam> = {},
): ReadSignature<DefaultModelInput> {
  return offsetLimitSignature(options, {}) as ReadSignature<DefaultModelInput>;
}

/** The default signature with host names for path, offset, and limit. */
export function renamedSignature(
  options: SignatureDocs<ReadParam> & { readonly names: Partial<Record<ReadParam, string>> },
): ReadSignature {
  if (options === null || typeof options !== "object") {
    throw new TypeError("renamedSignature options must be an object");
  }
  const { names, ...docs } = options;
  return offsetLimitSignature(docs, names);
}

function offsetLimitSignature(
  docs: SignatureDocs<ReadParam>,
  names: Partial<Record<ReadParam, string>>,
): ReadSignature {
  const name = resolveNames(PARAMS, names);
  const keys = PARAMS.map((param) => name[param]);
  const describe = docs.describe ?? {};
  const schema = objectSchema(
    [
      [
        name.path,
        pathSchema(
          describe.path ??
            "Path to read, relative to the working directory or absolute within an allowed root.",
        ),
      ],
      [
        name.offset,
        lineSchema(describe.offset ?? "One-based source line to start reading at. Defaults to 1."),
      ],
      [
        name.limit,
        lineSchema(
          describe.limit ??
            "Maximum number of source lines to return, before the configured limits apply.",
        ),
      ],
    ],
    name.path,
  );

  return Object.freeze<ReadSignature>({
    name: docs.name ?? DEFAULT_NAME,
    description:
      docs.description ??
      `Read a UTF-8 text file. \`${name.offset}\` is a one-based source line and ` +
        `\`${name.limit}\` is a number of source lines. Output is bounded by line, byte, and ` +
        "line-length limits. When the result reports truncation, follow the continuation it " +
        `returns instead of guessing the next \`${name.offset}\`. Paths outside the allowed ` +
        "roots, binary content, and special files are refused.",
    schema,
    toRead(input) {
      const record = readObject(input, keys);
      const path = readPath(record[name.path], name.path);
      const offset = readLine(record[name.offset], name.offset);
      const limit = readLine(record[name.limit], name.limit);
      return canonical(path, offset, limit);
    },
    fromRead(retry) {
      const model: Record<string, string | number> = { [name.path]: retry.path };
      if (retry.offset !== undefined) model[name.offset] = retry.offset;
      if (retry.limit !== undefined) model[name.limit] = retry.limit;
      return model as JsonObject;
    },
  });
}

export function canonical(path: string, offset?: number, limit?: number): ReadInput {
  return {
    path,
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit }),
  };
}
