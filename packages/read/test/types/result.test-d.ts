// Type tests: `tsc -b` checks this file; Bun never runs it.
import type { ReadErrorCode, ReadPhase, ReadResult, ToolError } from "../../src/index.ts";

declare const result: ReadResult;

// Every variant names its tool.
export const tool: "read" = result.tool;

// A plain status check narrows to the one variant with a non-null error.
if (result.status === "error") {
  const code: ReadErrorCode = result.error.code;
  const phase: ReadPhase = result.error.phase;
  const message: string = result.error.message;
  const shared: ToolError = result.error;
  void [code, phase, message, shared];
}

// The other variants have no error field.
if (result.status !== "error") {
  // @ts-expect-error only the error variant has error
  void result.error;
}
