import { memoryFileSystem } from "@better-fs-tools/fs";
import { textOf } from "@better-fs-tools/read";
import { createEditTool } from "@better-fs-tools/write";
import type { MutationResult } from "@better-fs-tools/write";

const edit = createEditTool({
  fs: memoryFileSystem({ files: { "/app.ts": "const a = 1;\nconst b = 2;\n" } }),
});

const result: MutationResult = await edit({
  path: "/app.ts",
  edits: [{ oldText: "const b = 2;", newText: "const b = 3;" }],
});

if (result.status === "error") {
  // A stable code, the stage that stopped the call, and the data of the error note.
  console.log(result.error.code, result.error.phase, result.error.data);
} else {
  for (const change of result.changes) {
    console.log(change.kind, change.path, `+${change.linesAdded} -${change.linesRemoved}`);
    console.log(change.diff); // The full unified diff. The model text has only a snippet.
    console.log(change.after?.version); // The backend version after the commit
  }
}
// Notes for the model, such as fuzzy-match. This plain update has none.
console.log(result.notes.map((note) => note.code)); // []
console.log(textOf(result)); // What the model sees
