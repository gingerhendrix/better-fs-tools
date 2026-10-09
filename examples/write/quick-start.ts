import { memoryFileSystem } from "@better-fs-tools/fs";
import { memoryStore, textOf } from "@better-fs-tools/read";
import { createFsTools } from "@better-fs-tools/write";

const fs = memoryFileSystem({ files: { "/src/app.ts": "export const a = 1;\n" } });

// read, edit, and write with one sha256Digest() and one lock manager.
const { edit, write } = createFsTools({ fs });

const edited = await edit({ path: "/src/app.ts", edits: [{ oldText: "1", newText: "2" }] });
console.log(textOf(edited)); // Edited /src/app.ts: 1 replacement at line 1.

const created = await write({ path: "/src/b.ts", content: "export const b = 1;\n" });
console.log(textOf(created)); // Created /src/b.ts (1 line).

// With a read store, edit and write need a read of an existing file first.
const checked = createFsTools({ fs, state: memoryStore() });
const bump = { path: "/src/app.ts", edits: [{ oldText: "2", newText: "3" }] };
console.log(textOf(await checked.edit(bump)));
// [edit:not-read] Read /src/app.ts with the read tool before changing it.

await checked.read({ path: "/src/app.ts" });
console.log(textOf(await checked.edit(bump))); // Edited /src/app.ts: 1 replacement at line 1.
