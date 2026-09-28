import { memoryFileSystem } from "@better-fs-tools/fs";
import { denyPaths, textOf } from "@better-fs-tools/read";
import {
  askBeforeWrite,
  createWriteTool,
  protectPaths,
  writeAuthorizers,
} from "@better-fs-tools/write";

const fs = memoryFileSystem({ directories: ["/repo"] });

const write = createWriteTool({
  fs,
  authorize: writeAuthorizers(
    // A tool-neutral authorizer from read works here too. It runs before any content byte is read.
    denyPaths(["**/.env", "**/.env.*"]),
    // AGENTS.md, CLAUDE.md, and .git/** are refused unless `ask` says yes.
    protectPaths(),
    // One question for the whole plan, with every diff.
    askBeforeWrite(async (plan) => {
      for (const change of plan) console.log(change.diff);
      return true; // or false, or { content } with the user's own text
    }),
  ),
});

console.log(textOf(await write({ path: "/repo/.env", content: "TOKEN=1\n" })));
// [write:denied] /repo/.env was refused by policy (the path matches a denied pattern).
console.log(textOf(await write({ path: "/repo/AGENTS.md", content: "# Rules\n" })));
// [write:denied] /repo/AGENTS.md was refused by policy (the path is protected).
console.log((await write({ path: "/repo/notes.md", content: "hello\n" })).status); // "ok"
