import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool, textOf } from "@better-fs-tools/read";

const fs = memoryFileSystem({
  files: { "/src/index.ts": "export const a = 1;\n" },
  directories: ["/src/empty"],
});
fs.setFile("/src/b.ts", "export const b = 2;\n");

const read = createReadTool({ fs });
console.log(textOf(await read({ path: "/src/b.ts" }))); // "1|export const b = 2;"
