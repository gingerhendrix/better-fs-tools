import { memoryFileSystem } from "@better-fs-tools/fs";
import { textOf } from "@better-fs-tools/read";
import { createFsTools } from "@better-fs-tools/write";

const fs = memoryFileSystem({ files: { "/src/app.ts": "export const a = 1;\n" } });

// read, edit, write, and apply_patch with one store, one sha256Digest(), and
// one lock manager, so edit and write know what the model has read.
const { read, edit, write } = createFsTools({ fs });

console.log(textOf(await edit({ path: "/src/app.ts", edits: [{ oldText: "1", newText: "2" }] })));
// [edit:not-read] Read /src/app.ts with the read tool before changing it.

await read({ path: "/src/app.ts" });
const edited = await edit({ path: "/src/app.ts", edits: [{ oldText: "1", newText: "2" }] });
console.log(textOf(edited));
// Edited /src/app.ts: 1 replacement at line 1.
// 1|export const a = 2;

const created = await write({ path: "/src/b.ts", content: "export const b = 1;\n" });
console.log(textOf(created)); // Created /src/b.ts (1 line).
