import type { WriteInput } from "../contract/input.ts";
import type { CanonicalParam } from "../contract/messages.ts";
import type { MutationSignatureDocs, WriteSignature } from "./contract.ts";
import {
  checkDocs,
  deepFreeze,
  objectSchema,
  pathSchema,
  readObject,
  readPath,
  readString,
  stringSchema,
} from "./schema.ts";

/** write({ path, content }). */
export function defaultWriteSignature(
  options: MutationSignatureDocs<"path" | "content"> = {},
): WriteSignature {
  return writeSignature(options, "defaultWriteSignature", "write", "path");
}

/** write_file({ file_path, content }). */
export function snakeCaseWriteSignature(
  options: MutationSignatureDocs<"file_path" | "content"> = {},
): WriteSignature {
  return writeSignature(options, "snakeCaseWriteSignature", "write_file", "file_path");
}

function writeSignature(
  options: MutationSignatureDocs<string>,
  label: string,
  name: string,
  pathName: string,
): WriteSignature {
  const keys = [pathName, "content"];
  const describe = checkDocs(options, label, keys);
  const schema = deepFreeze(
    objectSchema(
      [
        [
          pathName,
          pathSchema(
            describe[pathName] ??
              "Path of the file to create or replace, relative to the working directory or absolute within an allowed root.",
          ),
        ],
        [
          "content",
          stringSchema(
            describe.content ??
              "The complete new content of the file. Nothing of the old content is kept.",
          ),
        ],
      ],
      keys,
    ),
  );
  const params: Partial<Record<CanonicalParam, string>> = { path: pathName };

  return Object.freeze<WriteSignature>({
    name: options.name ?? name,
    description:
      options.description ??
      "Create a text file, or replace all of its content. Missing parent directories are " +
        "created. To replace a file that exists, read all of it with the read tool first. " +
        "To change part of a file, use the edit tool: it sends less text and keeps the rest " +
        "of the file as it is.",
    schema,
    toInput(input): WriteInput {
      const record = readObject(input, "write input", keys, keys);
      return {
        path: readPath(record[pathName], pathName),
        content: readString(record.content, "content"),
      };
    },
    param: (canonical) => params[canonical] ?? canonical,
  });
}
