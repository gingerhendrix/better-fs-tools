// Type tests: `tsc -b` checks this file; Bun never runs it.
import { memoryFileSystem } from "@better-fs-tools/fs";

import { charsPerToken, createReadTool, redact, repeatReadGuard } from "../../src/index.ts";
import type {
  AfterReadContext,
  ReadHook,
  ReadHookContext,
  ReadRecord,
  TruncationReason,
  ViewBudget,
} from "../../src/index.ts";

interface Host {
  readonly id: string;
}

const fs = memoryFileSystem();

// Host-free hooks and the budget fit a tool with a typed host.
export const hostFree = createReadTool<Host>({
  fs,
  hooks: [repeatReadGuard(), redact({ patterns: [/AKIA[0-9A-Z]{16}/g] })],
  budget: charsPerToken({ ratio: 4, max: 1_000 }),
});
export const unknownGuard: ReadHook<Host> = repeatReadGuard();
export const plainTool = createReadTool({ fs, hooks: [repeatReadGuard()] });

// A host-typed hook reads ctx.call.host and ctx.previous with their types.
const sessionHook: ReadHook<Host> = {
  id: "session",
  afterRead(outcome, ctx) {
    const id: string = ctx.call.host.id;
    const previous: ReadRecord | null = ctx.previous;
    if (previous === null || id === "") return outcome;
    return { ...outcome, notes: [...outcome.notes] };
  },
};

// Host-free and host-typed hooks mix in one list.
export const mixed = createReadTool<Host>({
  fs,
  hooks: [repeatReadGuard(), sessionHook, redact({ patterns: [/x/g] })],
});

// An inline hook takes its host type from the tool.
export const inline = createReadTool<Host>({
  fs,
  hooks: [
    { id: "inline", afterRead: (outcome, ctx) => (ctx.call.host.id === "" ? outcome : outcome) },
  ],
});

createReadTool<Host>({
  fs,
  hooks: [
    {
      id: "inline",
      // @ts-expect-error the host has no session field
      afterRead: (outcome, ctx) => (ctx.call.host.session ? outcome : outcome),
    },
  ],
});

// A hook for another host type does not fit.
declare const otherHook: ReadHook<{ user: number }>;
// @ts-expect-error the host types differ
createReadTool<Host>({ fs, hooks: [otherHook] });

// The context widens to unknown and is a ReadHookContext.
declare const afterRead: AfterReadContext<Host>;
export const widened: AfterReadContext<unknown> = afterRead;
export const asHookContext: ReadHookContext<Host> = afterRead;
declare const unknownAfterRead: AfterReadContext<unknown>;
// @ts-expect-error an unknown host is not a Host
export const narrowed: AfterReadContext<Host> = unknownAfterRead;

// A hook returns an outcome, not a result or a partial object.
export const badHook: ReadHook<unknown> = {
  id: "bad",
  // @ts-expect-error a hook must return an outcome
  afterRead: () => ({ status: "ok" }),
};

// The budget is sync and has a numeric max.
export const badBudget: ViewBudget = {
  id: "bad",
  // @ts-expect-error measure is sync
  measure: async (text: string) => text.length,
  max: 1,
};
// @ts-expect-error charsPerToken needs ratio and max
charsPerToken({ ratio: 4 });

// "budget" is a truncation reason.
export const reason: TruncationReason = "budget";
