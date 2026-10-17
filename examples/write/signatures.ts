import { memoryFileSystem } from "@better-fs-tools/fs";
import { createEditTool } from "@better-fs-tools/write";
import {
  defaultEditSignature,
  freeformPatchSignature,
  multiEditSignature,
  writeSignatureMessages,
} from "@better-fs-tools/write/signature";

// What the model sees: a name, a description, and a JSON Schema.
const signature = defaultEditSignature({
  name: "edit_file",
  names: {
    path: "filePath",
    old_string: "oldString",
    new_string: "newString",
    replace_all: "replaceAll",
  },
});
console.log(signature.name, Object.keys(signature.schema.properties ?? {}));
// edit_file [ "filePath", "oldString", "newString", "replaceAll" ]

// toInput checks model input and maps it to the core's canonical input.
console.log(signature.toInput({ filePath: "a.ts", oldString: "x", newString: "y" }));
// { path: "a.ts", edits: [ { oldText: "x", newText: "y" } ] }

// Behind a signature, pass its message names, so errors name filePath, not path.
const edit = createEditTool({
  fs: memoryFileSystem({ files: { "/a.ts": "x\n" } }),
  messages: writeSignatureMessages(signature),
});
export async function run(input: unknown) {
  return edit(signature.toInput(input));
}

// The names keys are the default signature's own parameter names.
export const renamed = defaultEditSignature({
  names: { path: "file", old_string: "find", new_string: "replace" },
}); // edit({ file, find, replace, replace_all? })

// Two presets give a shape that names alone cannot give.
export const presets = [
  multiEditSignature(), // edit({ path, edits: [{ oldText, newText }] }), many replacements in one call
  freeformPatchSignature(), // apply_patch({ patch }) plus the Codex Lark grammar for grammar-tool hosts
];
