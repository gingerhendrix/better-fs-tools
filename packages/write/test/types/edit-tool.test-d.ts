// Type tests: `tsc -b` checks this file; Bun never runs it.
import { memoryFileSystem } from "@better-fs-tools/fs";
import type { ToolCallContext } from "@better-fs-tools/read";

import {
  blockAnchorMatcher,
  createEditTool,
  defaultEditMatchers,
  defaultPatchMatchers,
  escapeMatcher,
  exactMatcher,
  indentationMatcher,
  lineTrimmedMatcher,
  normalizedMatcher,
} from "../../src/index.ts";
import type {
  EditInput,
  EditTool,
  EditToolDeps,
  Matcher,
  MatchInfo,
  MutationResult,
} from "../../src/index.ts";

interface Host {
  readonly id: string;
}

const fs = memoryFileSystem();

// No host: ctx and host are optional.
export const plain: EditTool = createEditTool({ fs });
export const called: Promise<MutationResult> = plain({
  path: "a",
  edits: [{ oldText: "b", newText: "c" }],
});
export const withAll: Promise<MutationResult> = plain(
  { path: "a", edits: [{ oldText: "b", newText: "c", replaceAll: true }] },
  { signal: AbortSignal.abort() },
);

// With a host: ctx and host are required.
export const hosted: EditTool<Host> = createEditTool<Host>({ fs });
export const hostedCall: Promise<MutationResult> = hosted(
  { path: "a", edits: [{ oldText: "b", newText: "c" }] },
  { host: { id: "h" } },
);
// @ts-expect-error: a host tool needs its context.
export const missingHost = hosted({ path: "a", edits: [] });
// @ts-expect-error: edits hold oldText and newText.
export const badInput: EditInput = { path: "a", edits: [{ old: "b", new: "c" }] };

// Matchers: every built-in fits Matcher, and a chain replaces the default.
export const chain: readonly Matcher[] = [
  exactMatcher(),
  normalizedMatcher(),
  escapeMatcher(),
  lineTrimmedMatcher(),
  indentationMatcher(),
  blockAnchorMatcher({ maxSpanRatio: 2 }),
  ...defaultEditMatchers(),
  ...defaultPatchMatchers(),
];
export const deps: EditToolDeps<Host> = {
  fs: (call: ToolCallContext<Host>) => (call.host.id === "" ? fs : fs),
  matchers: chain,
};
export const custom: Matcher = {
  id: "custom",
  fuzzy: true,
  describe: "anything",
  find: (haystack, needle, ctx) =>
    ctx.mode === "lines" ? [] : [{ start: 0, end: Math.min(haystack.length, needle.length) }],
  adapt: (newText, hit) => (hit.range.refused === "boundary" ? hit.needle : newText),
};
// @ts-expect-error: matchers is an edit dependency.
export const writeDeps: import("../../src/index.ts").WriteToolDeps = { fs, matchers: chain };

export const info: MatchInfo = {
  index: 0,
  matcher: "exact",
  fuzzy: false,
  lines: [1, 2],
  count: 1,
  replaced: [[1, 2]],
};
