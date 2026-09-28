import { Bash } from "just-bash";
import { justBashCommandRunner } from "@better-fs-tools/just-bash";
import { createBashTool, shellEnv, textOf } from "@better-fs-tools/shell";

// An emulated shell over an in-memory filesystem. Nothing starts a process.
// executionLimits stop a busy loop, because no timer fires while one runs.
const shell = new Bash({
  files: { "/workspace/notes.txt": "one\ntwo\n" },
  cwd: "/workspace",
  executionLimits: { maxCommandCount: 100_000 },
});

// shellEnv() gives defaultShellEnv only: the emulated shell sees no host variables.
const bash = createBashTool({ runner: justBashCommandRunner(shell), env: shellEnv() });

console.log(textOf(await bash({ command: "wc -l notes.txt" })));
// Exit code 0 · 0 s
// 2 notes.txt
