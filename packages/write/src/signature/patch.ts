import type { SignatureDocs } from "@better-fs-tools/read";

import type { ApplyPatchInput } from "../contract/input.ts";
import { CODEX_PATCH_GRAMMAR } from "../patch/grammar.ts";
import type { PatchSignature } from "./contract.ts";
import {
  checkDocs,
  deepFreeze,
  nonBlankSchema,
  objectSchema,
  readNonBlank,
  readObject,
} from "./schema.ts";

const EXAMPLE = [
  "*** Begin Patch",
  "*** Update File: src/app.ts",
  "@@ export function main() {",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "*** Add File: docs/notes.md",
  "+# Notes",
  "*** Delete File: old.txt",
  "*** End Patch",
].join("\n");

/**
 * Works with and without grammar support: it names the `patch` parameter but
 * never says whether to wrap the text in JSON, because a model without
 * grammar tools sends JSON.
 */
const patchDescription = (patch: string): string =>
  "Apply a patch that adds, updates, moves, or deletes text files. The input is one patch " +
  `text (the \`${patch}\` parameter) in the Codex apply_patch format:\n\n` +
  `${EXAMPLE}\n\n` +
  "In an Update, each line starts with a space (context), `-` (remove), or `+` (add). " +
  "`@@ <line>` names a line above the change to find the right place. Put " +
  "`*** Move to: <path>` after an Update line to rename the file. Every line of an Add " +
  "starts with `+`. Every hunk is checked before any file changes: when one fails, no file " +
  "changes. Read each file you update or delete with the read tool first.";

/** apply_patch({ patch }) as JSON, with a short example in the description. */
export function defaultPatchSignature(options: SignatureDocs<"patch"> = {}): PatchSignature {
  return patchSignature(options, "defaultPatchSignature");
}

/** The same schema plus grammar.lark = CODEX_PATCH_GRAMMAR. The description works with and without grammar support. */
export function freeformPatchSignature(options: SignatureDocs<"patch"> = {}): PatchSignature {
  return Object.freeze<PatchSignature>({
    ...patchSignature(options, "freeformPatchSignature"),
    grammar: Object.freeze({ lark: CODEX_PATCH_GRAMMAR }),
  });
}

/** One required string property, so Pi can use it as a grammar tool. */
function patchSignature(options: SignatureDocs<"patch">, label: string): PatchSignature {
  const { describe, names } = checkDocs(options, label, ["patch"]);
  const keys = [names.patch];
  const schema = deepFreeze(
    objectSchema(
      [
        [
          names.patch,
          nonBlankSchema(
            describe.patch ?? "The whole patch, from *** Begin Patch to *** End Patch.",
          ),
        ],
      ],
      keys,
    ),
  );
  return Object.freeze<PatchSignature>({
    name: options.name ?? "apply_patch",
    description: options.description ?? patchDescription(names.patch),
    schema,
    toInput(input): ApplyPatchInput {
      const record = readObject(input, "apply_patch input", keys, keys);
      return { patch: readNonBlank(record[names.patch], names.patch) };
    },
    param: (name) => (name === "patch" ? names.patch : name),
  });
}
