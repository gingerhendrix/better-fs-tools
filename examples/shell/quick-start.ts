import { createNodeBashTool } from "@better-fs-tools/node";
import { textOf } from "@better-fs-tools/shell";

// bash -c in process.cwd(), with process.env, a 2 minute timeout, and a
// 30 000 byte view of the output.
const bash = createNodeBashTool();

const listed = await bash({ command: "ls package.json" });
console.log(textOf(listed));
// Exit code 0 · 0 s
// package.json

const failed = await bash({ command: "grep -q nothing-here package.json" });
if (failed.status === "failed") console.log(failed.run.exitCode); // 1

const slow = await bash({ command: "sleep 5", timeoutMs: 100 });
console.log(textOf(slow));
// Timed out after 0.1 s. The process tree was stopped.
// (no output)
