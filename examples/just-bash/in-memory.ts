import { InMemoryFs } from "just-bash";
import { justBashReadFileSystem } from "@better-fs-tools/just-bash";
import { createReadTool, textOf } from "@better-fs-tools/read";

const bash = new InMemoryFs({ "/workspace/src/index.ts": "const a = 1;\n" });

const read = createReadTool({
  fs: justBashReadFileSystem(bash, {
    id: "sandbox",
    cwd: "/workspace",
    allowedRoots: ["/workspace"],
    maxBufferedBytes: 4 * 1024 * 1024,
  }),
});

console.log(textOf(await read({ path: "src/index.ts" })));
// 1|const a = 1;
//
// [read:weak-identity] The sandbox backend has no stable identity, ...
// [read:buffered-backend] The sandbox backend buffers whole objects instead of streaming them.
