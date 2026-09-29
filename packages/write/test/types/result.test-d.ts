// Type tests: `tsc -b` checks this file; Bun never runs it.
import type { ToolError } from "@better-fs-tools/read";

import type { MutationResult, WriteErrorCode, WritePhase, WriteToolName } from "../../src/index.ts";

declare const result: MutationResult;

export const tool: WriteToolName = result.tool;

// A plain status check narrows to the one variant with a non-null error.
if (result.status === "error") {
  const code: WriteErrorCode = result.error.code;
  const phase: WritePhase = result.error.phase;
  const message: string = result.error.message;
  const shared: ToolError = result.error;
  void [code, phase, message, shared, result.commit];
}

// The other variants have no error field, and no commit report.
if (result.status !== "error") {
  // @ts-expect-error only the error variant has error
  void result.error;
  const commit: null = result.commit;
  void commit;
}
