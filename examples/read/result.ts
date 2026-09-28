import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool } from "@better-fs-tools/read";

const read = createReadTool({ fs: memoryFileSystem({ files: { "/a.ts": "const a = 1;\n" } }) });
const result = await read({ path: "/a.ts" });

if (result.status === "ok") {
  console.log(result.view.lines); // [{ number: 1, text: "const a = 1;", clamped: false, sourceChars: null }]
  console.log(result.view.bytes); // 12: source bytes, before the gutter
  console.log(result.continuation); // { available: false, next: null }
  console.log(result.totals); // { lines: 1, exact: true, bytes: 13 }
  console.log(result.file.resolvedFrom); // null: no resolver changed the path
} else if (result.status === "error") {
  console.log(result.error.code, result.error.phase); // only the error variant has `error`
}
