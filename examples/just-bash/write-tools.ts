import { InMemoryFs } from "just-bash";
import { justBashFileSystem } from "@better-fs-tools/just-bash";
import { nodeDigest } from "@better-fs-tools/node";
import { createReadTool, memoryStore, textOf } from "@better-fs-tools/read";
import { createEditTool, memoryLocks } from "@better-fs-tools/write";

const bash = new InMemoryFs({ "/workspace/src/index.ts": "const a = 1;\n" });
const fs = justBashFileSystem(bash, {
  id: "sandbox",
  cwd: "/workspace",
  allowedRoots: ["/workspace"],
  maxBufferedBytes: 4 * 1024 * 1024,
});
const shared = { fs, state: memoryStore(), digest: nodeDigest() };
const read = createReadTool(shared);
const edit = createEditTool({ ...shared, locks: memoryLocks() });

await read({ path: "src/index.ts" });
console.log(textOf(await edit({ path: "src/index.ts", edits: [{ oldText: "1", newText: "2" }] })));
// Edited src/index.ts: 1 replacement at line 1.
console.log(await bash.readFile("/workspace/src/index.ts")); // const a = 2;
