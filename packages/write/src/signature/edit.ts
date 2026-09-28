import type { EditInput, EditPair } from "../contract/input.ts";
import type { Matcher } from "../contract/matcher.ts";
import type { CanonicalParam } from "../contract/messages.ts";
import type { EditSignature, MutationSignatureDocs } from "./contract.ts";
import { checkMatchers, matchingSentence } from "./matching.ts";
import {
  booleanSchema,
  checkDocs,
  deepFreeze,
  objectSchema,
  pathSchema,
  readFlag,
  readObject,
  readPath,
  readString,
  stringSchema,
} from "./schema.ts";

const NAME = "edit";
const PATH_TEXT =
  "Path of the file to edit, relative to the working directory or absolute within an allowed root.";
const READ_FIRST = "Read the file with the read tool before you edit it.";
const NO_PREFIX = "Copy old text from the file without the line-number prefix the read tool adds.";
const USE_WRITE = "To create a file or replace all of its content, use the write tool.";

type MatcherOption = { readonly matchers?: readonly Matcher[] };

/** edit({ path, old_string, new_string, replace_all? }). Name "edit". */
export function defaultEditSignature(
  options: MutationSignatureDocs<"path" | "old_string" | "new_string" | "replace_all"> &
    MatcherOption = {},
): EditSignature {
  return singleEditSignature(options, "defaultEditSignature", {
    path: "path",
    old: "old_string",
    new: "new_string",
    all: "replace_all",
  });
}

/** edit({ filePath, oldString, newString, replaceAll? }). OpenCode and Kilo Code. */
export function camelCaseEditSignature(
  options: MutationSignatureDocs<"filePath" | "oldString" | "newString" | "replaceAll"> &
    MatcherOption = {},
): EditSignature {
  return singleEditSignature(options, "camelCaseEditSignature", {
    path: "filePath",
    old: "oldString",
    new: "newString",
    all: "replaceAll",
  });
}

interface SingleNames {
  readonly path: string;
  readonly old: string;
  readonly new: string;
  readonly all: string;
}

function singleEditSignature(
  options: MutationSignatureDocs<string> & MatcherOption,
  label: string,
  names: SingleNames,
): EditSignature {
  const keys = [names.path, names.old, names.new, names.all];
  const describe = checkDocs(options, label, keys);
  const matchers = checkMatchers(options.matchers);
  const schema = deepFreeze(
    objectSchema(
      [
        [names.path, pathSchema(describe[names.path] ?? PATH_TEXT)],
        [
          names.old,
          stringSchema(
            describe[names.old] ??
              `Text to replace. It must match one place in the file unless ${names.all} is true.`,
            true,
          ),
        ],
        [
          names.new,
          stringSchema(
            describe[names.new] ?? `Replacement text. Send an empty string to delete ${names.old}.`,
          ),
        ],
        [
          names.all,
          booleanSchema(
            describe[names.all] ?? `Replace every place ${names.old} matches. Default false.`,
          ),
        ],
      ],
      [names.path, names.old, names.new],
    ),
  );
  const params: Partial<Record<CanonicalParam, string>> = {
    path: names.path,
    oldText: names.old,
    newText: names.new,
    replaceAll: names.all,
  };

  return Object.freeze<EditSignature>({
    name: options.name ?? NAME,
    description:
      options.description ??
      `Edit a text file by replacing text. \`${names.old}\` must match exactly one place in ` +
        `the file: add surrounding lines to make it unique, or set \`${names.all}\` to change ` +
        `every place. ${matchingSentence(matchers, names.old)} ${NO_PREFIX} ${READ_FIRST} ` +
        `After an edit, the same file can be edited again without another read. ${USE_WRITE}`,
    schema,
    toInput(input): EditInput {
      const record = readObject(input, "edit input", keys, [names.path, names.old, names.new]);
      const path = readPath(record[names.path], names.path);
      const oldText = readString(record[names.old], names.old, true);
      const newText = readString(record[names.new], names.new);
      const replaceAll = readFlag(record[names.all], names.all);
      const pair: EditPair =
        replaceAll === undefined ? { oldText, newText } : { oldText, newText, replaceAll };
      return { path, edits: [pair] };
    },
    param: (name) => params[name] ?? name,
  });
}

/**
 * edit({ path, edits: [{ oldText, newText }] }). Pi and Cloudflare Computer.
 * No replaceAll: param("replaceAll") is "", so no message suggests it.
 */
export function multiEditSignature(
  options: MutationSignatureDocs<"path" | "edits" | "oldText" | "newText"> & MatcherOption = {},
): EditSignature {
  const keys = ["path", "edits"];
  const pairKeys = ["oldText", "newText"];
  const describe = checkDocs(options, "multiEditSignature", ["path", "edits", ...pairKeys]);
  const matchers = checkMatchers(options.matchers);
  const pair = objectSchema(
    [
      [
        "oldText",
        stringSchema(
          describe.oldText ??
            "Text for one replacement. It must match one place in the original file and must not overlap another edit.",
          true,
        ),
      ],
      [
        "newText",
        stringSchema(
          describe.newText ?? "Replacement text. Send an empty string to delete oldText.",
        ),
      ],
    ],
    pairKeys,
  );
  const schema = deepFreeze(
    objectSchema(
      [
        ["path", pathSchema(describe.path ?? PATH_TEXT)],
        [
          "edits",
          {
            type: "array",
            minItems: 1,
            items: pair,
            description:
              describe.edits ??
              "One or more replacements. Each is matched against the original file, not after earlier edits. Merge nearby changes into one edit.",
          },
        ],
      ],
      keys,
    ),
  );

  return Object.freeze<EditSignature>({
    name: options.name ?? NAME,
    description:
      options.description ??
      "Edit a text file with one or more replacements in one call. Each `edits[].oldText` " +
        "must match exactly one place in the original file. Edits must not overlap or nest: " +
        `merge nearby changes into one edit. ${matchingSentence(matchers, "edits[].oldText")} ` +
        `${NO_PREFIX} ${READ_FIRST} After an edit, the same file can be edited again without ` +
        `another read. ${USE_WRITE}`,
    schema,
    toInput(input): EditInput {
      const record = readObject(input, "edit input", keys, keys);
      const path = readPath(record.path, "path");
      const edits = record.edits;
      if (!Array.isArray(edits) || edits.length === 0) {
        throw new TypeError("edits must be a non-empty array");
      }
      return {
        path,
        edits: edits.map((entry, index) => {
          const label = `edits[${index}]`;
          const item = readObject(entry, label, pairKeys, pairKeys, `${label}.`);
          return {
            oldText: readString(item.oldText, `${label}.oldText`, true),
            newText: readString(item.newText, `${label}.newText`),
          };
        }),
      };
    },
    param: (name) => (name === "replaceAll" ? "" : name),
  });
}
