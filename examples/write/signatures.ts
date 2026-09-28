import { memoryFileSystem } from "@better-fs-tools/fs";
import { createEditTool } from "@better-fs-tools/write";
import {
  camelCaseEditSignature,
  defaultEditSignature,
  freeformPatchSignature,
  multiEditSignature,
  writeSignatureMessages,
} from "@better-fs-tools/write/signature";

// What the model sees: a name, a description, and a JSON Schema.
const signature = camelCaseEditSignature({ name: "edit_file" });
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

// The other presets.
export const presets = [
  defaultEditSignature(), // edit({ path, old_string, new_string, replace_all? })
  multiEditSignature(), // edit({ path, edits: [{ oldText, newText }] }), Pi's shape
  freeformPatchSignature(), // apply_patch({ patch }) plus a Lark grammar for grammar-tool hosts
];
