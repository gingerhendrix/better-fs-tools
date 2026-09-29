import type { SignatureDocs } from "@better-fs-tools/read";

import type { WriteInput } from "../contract/input.ts";
import type { WriteCanonicalParam } from "../contract/messages.ts";
import type { WriteSignature } from "./contract.ts";
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
  options: SignatureDocs<"path" | "content"> = {},
): WriteSignature {
  return writeSignature(options, "defaultWriteSignature", "write", "path");
}

/**
 * write_file({ file_path, content }). Claude Code. The same as
 * defaultWriteSignature with another tool name and path name.
 */
export function snakeCaseWriteSignature(
  options: SignatureDocs<"file_path" | "content"> = {},
): WriteSignature {
  return writeSignature(options, "snakeCaseWriteSignature", "write_file", "file_path");
}

function writeSignature(
  options: SignatureDocs<string>,
  label: string,
  name: string,
  presetPathName: string,
): WriteSignature {
  const checked = checkDocs(options, label, [presetPathName, "content"]);
  const { describe } = checked;
  const pathName = checked.names[presetPathName] ?? presetPathName;
  const contentName = checked.names.content ?? "content";
  const keys = [pathName, contentName];
  const schema = deepFreeze(
    objectSchema(
      [
        [
          pathName,
          pathSchema(
            describe[presetPathName] ??
              "Path of the file to create or replace, relative to the working directory or absolute within an allowed root.",
          ),
        ],
        [
          contentName,
          stringSchema(
            describe.content ??
              "The complete new content of the file. Nothing of the old content is kept.",
          ),
        ],
      ],
      keys,
    ),
  );
  const params: Partial<Record<WriteCanonicalParam, string>> = {
    path: pathName,
    content: contentName,
  };

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
        content: readString(record[contentName], contentName),
      };
    },
    param: (canonical) => params[canonical] ?? canonical,
  });
}
