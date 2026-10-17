import type { ReadInput } from "../contract/input.ts";
import type { JsonObject } from "../contract/json.ts";
import type { SignatureDocs } from "../contract/base.ts";
import type { DefaultReadModelInput, ReadParam, ReadSignature } from "./contract.ts";
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

/**
 * A read({ path, offset?, limit? }) signature: a non-blank path without NUL,
 * and positive integer offset and limit. `names` renames any of the three
 * parameters.
 */
export function defaultReadSignature(
  options?: SignatureDocs<ReadParam> & { readonly names?: undefined },
): ReadSignature<DefaultReadModelInput>;
export function defaultReadSignature(options: SignatureDocs<ReadParam>): ReadSignature;
export function defaultReadSignature(options: SignatureDocs<ReadParam> = {}): ReadSignature {
  if (options === null || typeof options !== "object") {
    throw new TypeError("defaultReadSignature options must be an object");
  }
  const name = resolveNames(PARAMS, options.names);
  const keys = PARAMS.map((param) => name[param]);
  const describe = options.describe ?? {};
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
    name: options.name ?? DEFAULT_NAME,
    description:
      options.description ??
      `Read a UTF-8 text file. \`${name.offset}\` is a one-based source line and ` +
        `\`${name.limit}\` is a number of source lines. Output is bounded by line, byte, and ` +
        "line-length limits. When the result reports truncation, follow the continuation it " +
        `returns instead of guessing the next \`${name.offset}\`. Paths outside the allowed ` +
        "roots, binary content, and special files are refused.",
    schema,
    toInput(input) {
      const record = readObject(input, keys);
      const path = readPath(record[name.path], name.path);
      const offset = readLine(record[name.offset], name.offset);
      const limit = readLine(record[name.limit], name.limit);
      return canonical(path, offset, limit);
    },
    param: (canonical) => name[canonical],
    fromInput(retry) {
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
