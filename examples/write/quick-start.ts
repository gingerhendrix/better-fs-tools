import { memoryFileSystem } from "@better-fs-tools/fs";
import { nodeDigest } from "@better-fs-tools/node";
import { createReadTool, textOf } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";
import { createEditTool, createWriteTool, memoryLocks } from "@better-fs-tools/write";

const fs = memoryFileSystem({ files: { "/src/app.ts": "export const a = 1;\n" } });

// One store, one digest, and one lock manager for every tool, so edit and
// write know what the model has read.
const state = createMemoryStore();
const digest = nodeDigest();
const locks = memoryLocks();

const read = createReadTool({ fs, state, digest });
const edit = createEditTool({ fs, state, digest, locks });
const write = createWriteTool({ fs, state, digest, locks });

console.log(textOf(await edit({ path: "/src/app.ts", edits: [{ oldText: "1", newText: "2" }] })));
// [edit:not-read] Read /src/app.ts with the read tool before changing it.

await read({ path: "/src/app.ts" });
const edited = await edit({ path: "/src/app.ts", edits: [{ oldText: "1", newText: "2" }] });
console.log(textOf(edited));
// Edited /src/app.ts: 1 replacement at line 1.
// 1|export const a = 2;

const created = await write({ path: "/src/b.ts", content: "export const b = 1;\n" });
console.log(textOf(created)); // Created /src/b.ts (1 line).
