/**
 * Type tests for the apply_patch tool and the ./patch entry. `tsc -b`
 * checks this file; Bun never runs it.
 */
import { memoryFileSystem } from "@better-fs-tools/fs";
import type { ToolCallContext } from "@better-fs-tools/read";

import {
  codexPatchParser as rootParser,
  createApplyPatchTool,
  defaultPatchMatchers,
  exactMatcher,
} from "../../src/index.ts";
import type {
  ApplyPatchInput,
  ApplyPatchTool,
  ApplyPatchToolDeps,
  CommitReport,
  MutationResult,
} from "../../src/index.ts";
import { codexPatchParser, parsePatch } from "../../src/patch/index.ts";
import type {
  PatchHunk,
  PatchOperation,
  PatchParseOutcome,
  PatchParser,
  PatchPlan,
} from "../../src/patch/index.ts";

interface Host {
  readonly id: string;
}

const fs = memoryFileSystem();

// No host: ctx and host are optional.
export const plain: ApplyPatchTool = createApplyPatchTool({ fs });
export const called: Promise<MutationResult> = plain({ patch: "*** Begin Patch" });
export const aborted: Promise<MutationResult> = plain(
  { patch: "*** Begin Patch" },
  { signal: AbortSignal.abort() },
);

// With a host: ctx and host are required.
export const hosted: ApplyPatchTool<Host> = createApplyPatchTool<Host>({ fs });
export const hostedCall: Promise<MutationResult> = hosted({ patch: "p" }, { host: { id: "h" } });
// @ts-expect-error: a host tool needs its context.
export const missingHost = hosted({ patch: "p" });
// @ts-expect-error: the input is { patch }.
export const badInput: ApplyPatchInput = { input: "p" };

// Dependencies: matchers and patchParser join the shared ones.
export const deps: ApplyPatchToolDeps<Host> = {
  fs: (call: ToolCallContext<Host>) => (call.host.id === "" ? fs : fs),
  matchers: [exactMatcher(), ...defaultPatchMatchers()],
  patchParser: codexPatchParser(),
};
export const writeDeps: import("../../src/index.ts").WriteToolDeps = {
  fs,
  // @ts-expect-error: patchParser is an apply_patch dependency.
  patchParser: rootParser(),
};

// A host parser returns the same plan type.
export const custom: PatchParser = {
  id: "v4a",
  parse: (text): PatchParseOutcome =>
    text === ""
      ? { ok: false, error: { line: 1, detail: "empty" } }
      : { ok: true, plan: { operations: [{ kind: "delete", path: text, line: 1 }] } },
};
export const outcome: PatchParseOutcome = parsePatch("*** Begin Patch\n*** End Patch");
export const plan: PatchPlan | null = outcome.ok ? outcome.plan : null;
export const update: PatchOperation = {
  kind: "update",
  path: "a",
  moveTo: null,
  hunks: [],
  line: 1,
};
export const hunk: PatchHunk = {
  context: null,
  lines: [
    { kind: " ", text: "a" },
    // @ts-expect-error: a patch line is " ", "-", or "+".
    { kind: "@", text: "b" },
  ],
  endOfFile: false,
  line: 2,
};
export const report: CommitReport = {
  rolledBack: false,
  files: [{ path: "a", state: "rollback-failed", code: "IO_ERROR" }],
};
