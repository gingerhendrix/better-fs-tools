import { isWritableFileSystem, memoryFileSystem, readOnlyFileSystem } from "@better-fs-tools/fs";
import { createReadTool, textOf } from "@better-fs-tools/read";

// Any backend, with the write methods dropped. A read tool works as before,
// and a write tool refuses it when it is built.
const fs = readOnlyFileSystem(memoryFileSystem({ files: { "/notes.txt": "one\n" } }));
console.log(isWritableFileSystem(fs)); // false

const read = createReadTool({ fs });
console.log(textOf(await read({ path: "/notes.txt" }))); // "1|one"
