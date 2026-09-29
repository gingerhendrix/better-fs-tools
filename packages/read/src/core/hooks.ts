import type { AfterReadContext, ReadHook } from "../contract/extensions.ts";
import type { ReadNote, ReadReport } from "../contract/result.ts";
import type { ReadRecord } from "../contract/state.ts";
import type { CallScope } from "./call-scope.ts";
import { isContentPart } from "./converted.ts";
import { raceAbort } from "./cursor.ts";
import { extensionId } from "./extension-error.ts";
import { isRecord } from "./input.ts";
import { withEditedView } from "./observation.ts";
import { isNote } from "./outcomes.ts";
import { same } from "./same.ts";

const HOOK_FROZEN_FIELDS = [
  "tool",
  "request",
  "file",
  "classification",
  "conversion",
  "truncation",
  "continuation",
  "totals",
  "observation",
] as const;

const STATUSES: ReadonlySet<unknown> = new Set(["ok", "media", "unsupported", "error"]);

export async function runHooks<THost>(
  scope: CallScope<THost>,
  outcome: ReadReport,
): Promise<ReadReport> {
  const { hooks } = scope.deps;
  if (hooks.length === 0) return outcome;
  scope.enter("hooks");
  const ctx: AfterReadContext<THost> = Object.freeze({
    ...scope.hookContext(),
    previous: await previousRecord(scope, outcome),
  });
  let current = outcome;
  for (const hook of hooks) {
    current = await runHook(scope, hook, current, ctx);
  }
  return current;
}

async function runHook<THost>(
  scope: CallScope<THost>,
  hook: ReadHook<THost>,
  before: ReadReport,
  ctx: AfterReadContext<THost>,
): Promise<ReadReport> {
  scope.checkAbort();
  let produced: unknown;
  try {
    produced = await raceAbort(() => hook.afterRead(before, ctx), scope.signal);
  } catch (error) {
    scope.checkAbort();
    throw scope.extensionFailure("hooks", extensionId(hook, error));
  }
  scope.checkAbort();
  if (!keepsRules(before, produced)) throw scope.extensionFailure("hooks", extensionId(hook));
  if (!viewChanged(before, produced)) return produced;
  return markEdited(scope, hook.id, produced);
}

function markEdited<THost>(
  scope: CallScope<THost>,
  hookId: string,
  outcome: ReadReport,
): ReadReport {
  const { messages, digest } = scope.deps;
  const note: ReadNote = {
    code: "view-modified",
    severity: "info",
    message: messages.viewModified({ hook: hookId }),
    data: { hook: hookId },
  };
  const notes = [...outcome.notes, note];
  if (outcome.status !== "ok" && outcome.status !== "media") return { ...outcome, notes };
  if (outcome.observation === null || digest === null) return { ...outcome, notes };
  const view = outcome.status === "ok" ? viewText(outcome) : outcome.parts;
  return { ...outcome, notes, observation: withEditedView(digest, outcome.observation, view) };
}

async function previousRecord<THost>(
  scope: CallScope<THost>,
  outcome: ReadReport,
): Promise<ReadRecord | null> {
  if (outcome.file === null) return null;
  const store = scope.stateStore();
  if (store === null) return null;
  let record: unknown;
  try {
    record = await store.get(outcome.file.resolvedPath);
  } catch {
    // Session state is a cache: a failing store never fails the read.
    return null;
  }
  return isRecord(record) && record.schema === 2 ? (record as unknown as ReadRecord) : null;
}

function keepsRules(before: ReadReport, after: unknown): after is ReadReport {
  if (!isRecord(after) || !STATUSES.has(after.status)) return false;
  if (!Array.isArray(after.notes) || !after.notes.every(isNote)) return false;
  const refused = before.status === "error" || before.status === "unsupported";
  if (refused && (after.status === "ok" || after.status === "media")) return false;
  if (!editableFieldsWellTyped(after)) return false;
  for (const key of HOOK_FROZEN_FIELDS) {
    const had = Object.hasOwn(before, key);
    const has = Object.hasOwn(after, key);
    if (had && has && !same((before as unknown as Record<string, unknown>)[key], after[key]))
      return false;
    if (had !== has && before.status === after.status) return false;
  }
  return true;
}

function editableFieldsWellTyped(after: Record<string, unknown>): boolean {
  switch (after.status) {
    case "ok": {
      const { view } = after;
      return (
        isRecord(view) &&
        Array.isArray(view.lines) &&
        view.lines.every(
          (line) =>
            isRecord(line) &&
            typeof line.number === "number" &&
            typeof line.text === "string" &&
            typeof line.clamped === "boolean",
        )
      );
    }
    case "media":
      return Array.isArray(after.parts) && after.parts.every(isContentPart);
    case "unsupported":
      return typeof after.code === "string" && after.code !== "";
    default: {
      const { error } = after;
      return (
        isRecord(error) &&
        typeof error.code === "string" &&
        error.code !== "" &&
        typeof error.phase === "string" &&
        typeof error.message === "string"
      );
    }
  }
}

function viewChanged(before: ReadReport, after: ReadReport): boolean {
  if (before.status === "ok" && after.status === "ok") {
    const lines = (outcome: typeof before) =>
      outcome.view.lines.map((line) => [line.number, line.text]);
    return !same(lines(before), lines(after));
  }
  if (before.status === "media" && after.status === "media")
    return !same(before.parts, after.parts);
  return false;
}

function viewText(outcome: Extract<ReadReport, { status: "ok" }>): string {
  return outcome.view.lines.map((line) => line.text).join("\n");
}
