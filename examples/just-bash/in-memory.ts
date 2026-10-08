import { InMemoryFs } from "just-bash";
import { readOnlyFileSystem } from "@better-fs-tools/fs";
import { justBashFileSystem } from "@better-fs-tools/just-bash";
import { createReadTool, textOf } from "@better-fs-tools/read";

const bash = new InMemoryFs({ "/workspace/src/index.ts": "const a = 1;\n" });

// readOnlyFileSystem drops the write methods, so no write tool can use this view.
const read = createReadTool({
  fs: readOnlyFileSystem(
    justBashFileSystem(bash, {
      id: "sandbox",
      cwd: "/workspace",
      allowedRoots: ["/workspace"],
      maxBufferedBytes: 4 * 1024 * 1024,
    }),
  ),
});

console.log(textOf(await read({ path: "src/index.ts" })));
// 1|const a = 1;
