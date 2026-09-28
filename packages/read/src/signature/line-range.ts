import type { JsonObject } from "../contract/json.ts";
import type { SignatureDocs } from "../contract/base.ts";
import type { LineRangeParam, ReadSignature } from "./contract.ts";
import { canonical } from "./offset-limit.ts";
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

const PARAMS: readonly LineRangeParam[] = ["path", "start", "end"];

/**
 * read({ path, start?, end? }). Inclusive start and end. toInput: limit = end -
 * start + 1. fromInput: end = offset + limit - 1. param("limit") is "": no
 * parameter holds a line count.
 */
export function lineRangeSignature(options: SignatureDocs<LineRangeParam> = {}): ReadSignature {
  if (options === null || typeof options !== "object") {
    throw new TypeError("lineRangeSignature options must be an object");
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
      [name.start, lineSchema(describe.start ?? "First one-based line to read. Defaults to 1.")],
      [
        name.end,
        lineSchema(
          describe.end ??
            `Last line to read, inclusive. Must not be less than ${name.start}. Defaults to the end of the view limits.`,
        ),
      ],
    ],
    name.path,
  );

  return Object.freeze<ReadSignature>({
    name: options.name ?? DEFAULT_NAME,
    description:
      options.description ??
      `Read a UTF-8 text file. \`${name.start}\` and \`${name.end}\` are one-based, inclusive ` +
        "source lines. Output is bounded by line, byte, and line-length limits. When the result " +
        "reports truncation, follow the continuation it returns instead of guessing the next " +
        "range. Paths outside the allowed roots, binary content, and special files are refused.",
    schema,
    toInput(input) {
      const record = readObject(input, keys);
      const path = readPath(record[name.path], name.path);
      const start = readLine(record[name.start], name.start);
      const end = readLine(record[name.end], name.end);
      if (end === undefined) return canonical(path, start);
      const first = start ?? 1;
      if (end < first) {
        throw new TypeError(`${name.end} (${end}) must not be less than ${name.start} (${first})`);
      }
      return canonical(path, start, end - first + 1);
    },
    param: (canonical) =>
      canonical === "path" ? name.path : canonical === "offset" ? name.start : "",
    fromInput(retry) {
      const model: Record<string, string | number> = { [name.path]: retry.path };
      if (retry.offset !== undefined) model[name.start] = retry.offset;
      if (retry.limit !== undefined) model[name.end] = (retry.offset ?? 1) + retry.limit - 1;
      return model as JsonObject;
    },
  });
}
