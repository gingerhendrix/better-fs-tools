import type { SignatureDocs } from "@better-fs-tools/read";

import type { EditInput, EditPair } from "../contract/input.ts";
import type { Matcher } from "../contract/matcher.ts";
import type { WriteCanonicalParam } from "../contract/messages.ts";
import type { EditSignature } from "./contract.ts";
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
  options: SignatureDocs<"path" | "old_string" | "new_string" | "replace_all"> & MatcherOption = {},
): EditSignature {
  return singleEditSignature(options, "defaultEditSignature", {
    path: "path",
    old: "old_string",
    new: "new_string",
    all: "replace_all",
  });
}

/**
 * edit({ filePath, oldString, newString, replaceAll? }). OpenCode and Kilo Code.
 * The same as defaultEditSignature with camel-case names.
 */
export function camelCaseEditSignature(
  options: SignatureDocs<"filePath" | "oldString" | "newString" | "replaceAll"> &
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
  options: SignatureDocs<string> & MatcherOption,
  label: string,
  presetNames: SingleNames,
): EditSignature {
  const checked = checkDocs(options, label, [
    presetNames.path,
    presetNames.old,
    presetNames.new,
    presetNames.all,
  ]);
  const { describe } = checked;
  const rename = (param: string): string => checked.names[param] ?? param;
  const names: SingleNames = {
    path: rename(presetNames.path),
    old: rename(presetNames.old),
    new: rename(presetNames.new),
    all: rename(presetNames.all),
  };
  const keys = [names.path, names.old, names.new, names.all];
  const matchers = checkMatchers(options.matchers);
  const schema = deepFreeze(
    objectSchema(
      [
        [names.path, pathSchema(describe[presetNames.path] ?? PATH_TEXT)],
        [
          names.old,
          stringSchema(
            describe[presetNames.old] ??
              `Text to replace. It must match one place in the file unless ${names.all} is true.`,
            true,
          ),
        ],
        [
          names.new,
          stringSchema(
            describe[presetNames.new] ??
              `Replacement text. Send an empty string to delete ${names.old}.`,
          ),
        ],
        [
          names.all,
          booleanSchema(
            describe[presetNames.all] ?? `Replace every place ${names.old} matches. Default false.`,
          ),
        ],
      ],
      [names.path, names.old, names.new],
    ),
  );
  const params: Partial<Record<WriteCanonicalParam, string>> = {
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
 * Has no replaceAll parameter, so no message suggests one.
 */
export function multiEditSignature(
  options: SignatureDocs<"path" | "edits" | "oldText" | "newText"> & MatcherOption = {},
): EditSignature {
  const { describe, names } = checkDocs(options, "multiEditSignature", [
    "path",
    "edits",
    "oldText",
    "newText",
  ]);
  const keys = [names.path, names.edits];
  const pairKeys = [names.oldText, names.newText];
  const matchers = checkMatchers(options.matchers);
  const pair = objectSchema(
    [
      [
        names.oldText,
        stringSchema(
          describe.oldText ??
            "Text for one replacement. It must match one place in the original file and must not overlap another edit.",
          true,
        ),
      ],
      [
        names.newText,
        stringSchema(
          describe.newText ?? `Replacement text. Send an empty string to delete ${names.oldText}.`,
        ),
      ],
    ],
    pairKeys,
  );
  const schema = deepFreeze(
    objectSchema(
      [
        [names.path, pathSchema(describe.path ?? PATH_TEXT)],
        [
          names.edits,
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
  const old = `${names.edits}[].${names.oldText}`;

  return Object.freeze<EditSignature>({
    name: options.name ?? NAME,
    description:
      options.description ??
      `Edit a text file with one or more replacements in one call. Each \`${old}\` ` +
        "must match exactly one place in the original file. Edits must not overlap or nest: " +
        `merge nearby changes into one edit. ${matchingSentence(matchers, old)} ` +
        `${NO_PREFIX} ${READ_FIRST} After an edit, the same file can be edited again without ` +
        `another read. ${USE_WRITE}`,
    schema,
    toInput(input): EditInput {
      const record = readObject(input, "edit input", keys, keys);
      const path = readPath(record[names.path], names.path);
      const edits = record[names.edits];
      if (!Array.isArray(edits) || edits.length === 0) {
        throw new TypeError(`${names.edits} must be a non-empty array`);
      }
      return {
        path,
        edits: edits.map((entry, index) => {
          const label = `${names.edits}[${index}]`;
          const item = readObject(entry, label, pairKeys, pairKeys, `${label}.`);
          return {
            oldText: readString(item[names.oldText], `${label}.${names.oldText}`, true),
            newText: readString(item[names.newText], `${label}.${names.newText}`),
          };
        }),
      };
    },
    param: (name) =>
      name === "replaceAll" ? "" : ((names as Readonly<Record<string, string>>)[name] ?? name),
  });
}
