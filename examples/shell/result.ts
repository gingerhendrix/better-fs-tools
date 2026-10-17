import { nodeCommandRunner } from "@better-fs-tools/node";
import { createBashTool, shellEnv } from "@better-fs-tools/shell";

const bash = createBashTool({ runner: nodeCommandRunner(), env: shellEnv(() => process.env) });
const result = await bash({ command: "ls" });

if (result.status === "error") {
  console.log(result.error.code, result.error.phase); // only the error variant has `error`
} else {
  console.log(result.run.exitCode, result.output.totalBytes); // never null here
}
