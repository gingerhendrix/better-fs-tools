import { createNodeReadTool } from "@better-fs-tools/node";
import { textOf } from "@better-fs-tools/read";

// Rooted at process.cwd(), with SHA-256 observations.
const read = createNodeReadTool();

const result = await read({ path: "package.json", limit: 2 });
console.log(result.status); // "ok"
console.log(textOf(result));
// 1|{
// 2|  "name": "my-app",
//
// [read:continue] Output stopped at the line limit. Continue with {"path":"package.json","offset":3,"limit":2}.
