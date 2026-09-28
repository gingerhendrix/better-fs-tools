import { memoryFileSystem } from "@better-fs-tools/fs";
import { nodeDigest } from "@better-fs-tools/node";
import { createReadTool, textOf } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";
import { createApplyPatchTool } from "@better-fs-tools/write";

const fs = memoryFileSystem({
  files: { "/src/app.ts": "const a = 1;\nconst b = 2;\n", "/src/old.ts": "gone\n" },
});
const state = createMemoryStore();
const digest = nodeDigest();
const read = createReadTool({ fs, state, digest });
const applyPatch = createApplyPatchTool({ fs, state, digest });

await read({ path: "/src/app.ts" });
await read({ path: "/src/old.ts" });

const result = await applyPatch({
  patch: `*** Begin Patch
*** Update File: /src/app.ts
@@
 const a = 1;
-const b = 2;
+const b = 3;
*** Add File: /src/new.ts
+export const c = 4;
*** Delete File: /src/old.ts
*** End Patch`,
});
console.log(textOf(result));
// Success. Updated the following files:
// M /src/app.ts
// A /src/new.ts
// D /src/old.ts
