// Type tests: tsc checks this file; its name keeps Bun from running it.
import type { ToolError } from "@better-fs-tools/read";

import type {
  AfterRunHook,
  BeforeRunHook,
  ShellErrorCode,
  ShellOutput,
  ShellPhase,
  ShellResult,
  ShellRun,
} from "../../src/index.ts";

declare const result: ShellResult;

export const tool: "bash" = result.tool;

// A plain status check narrows to the one variant with a non-null error.
if (result.status === "error") {
  const code: ShellErrorCode = result.error.code;
  const phase: ShellPhase = result.error.phase;
  const message: string = result.error.message;
  const shared: ToolError = result.error;
  void [code, phase, message, shared];
} else {
  const run: ShellRun = result.run;
  const output: ShellOutput = result.output;
  // @ts-expect-error only the error variant has error
  void result.error;
  void [run, output];
}

// @ts-expect-error no aborted status
export const aborted: ShellResult["status"] = "aborted";

export const keepsStatus: AfterRunHook = {
  id: "no-status",
  // @ts-expect-error status is not part of the update
  afterRun: () => ({ status: "ok" }),
};

export const refuses: BeforeRunHook = { id: "no", beforeRun: () => ({ allow: false }) };
export const rewrites: BeforeRunHook = {
  id: "wrap",
  beforeRun: (run) => ({ allow: true, command: `nice ${run.command}` }),
};
