import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool, textOf } from "@better-fs-tools/read";

const read = createReadTool({
  fs: memoryFileSystem({ files: { "/notes.txt": "one\ntwo\nthree\n" } }),
});

const result = await read({ path: "/notes.txt", offset: 2 });
console.log(result.content); // [{ type: "text", text: "2|two\n3|three" }]
console.log(textOf(result)); // "2|two\n3|three"
