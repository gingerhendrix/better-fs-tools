import type { AfterReadContext, ReadHook } from "../contract/extensions.ts";
import type { ReadNote, ReadOutcome } from "../contract/result.ts";
import type { ReadRecord } from "../contract/state.ts";
import type { CallScope } from "./call-scope.ts";
import { isContentPart } from "./converted.ts";
import { raceAbort } from "./cursor.ts";
import { extensionId } from "./extension-error.ts";
import { isRecord } from "./input.ts";
import { withEditedView } from "./observation.ts";
import { isNote } from "./outcomes.ts";
import { same } from "./same.ts";

/**
 * Fields a hook must return with the same values. The core owns the
 * observation: it recomputes it after a hook edits the view.
 */
const FROZEN = [
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

/**
 * Runs the hooks in order, after verification and before record. After each
 * hook the core checks the rules: status cannot move from error or
 * unsupported to ok or media, and the frozen fields keep their values. A
 * throw or a broken rule gives EXTENSION_FAILED with extension "hooks" and the
 * hook id. When a hook changed the view text or the parts, the core
 * recomputes the observation and adds a view-modified note naming the hook.
 */
export async function runHooks<THost>(
  scope: CallScope<THost>,
  outcome: ReadOutcome,
): Promise<ReadOutcome> {
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
  before: ReadOutcome,
  ctx: AfterReadContext<THost>,
): Promise<ReadOutcome> {
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

/** Adds the view-modified note, and recomputes viewId with wholeFileVisible false. */
function markEdited<THost>(
  scope: CallScope<THost>,
  hookId: string,
  outcome: ReadOutcome,
): ReadOutcome {
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

/**
 * The stored record for this file from before this read. Asks for the store
 * (state(call) at most once for each read, shared with record). A failing get
 * gives null: session state is a cache.
 */
async function previousRecord<THost>(
  scope: CallScope<THost>,
  outcome: ReadOutcome,
): Promise<ReadRecord | null> {
  if (outcome.file === null) return null;
  const store = scope.stateStore();
  if (store === null) return null;
  let record: unknown;
  try {
    record = await store.get(outcome.file.resolvedPath);
  } catch {
    return null;
  }
  return isRecord(record) && record.schema === 1 ? (record as unknown as ReadRecord) : null;
}

/** The hook's return has the outcome shape, keeps the status rule, and keeps the frozen fields. */
function keepsRules(before: ReadOutcome, after: unknown): after is ReadOutcome {
  if (!isRecord(after) || !STATUSES.has(after.status)) return false;
  if (!Array.isArray(after.notes) || !after.notes.every(isNote)) return false;
  const refused = before.status === "error" || before.status === "unsupported";
  if (refused && (after.status === "ok" || after.status === "media")) return false;
  if (!hasShape(after)) return false;
  for (const key of FROZEN) {
    const had = Object.hasOwn(before, key);
    const has = Object.hasOwn(after, key);
    if (had && has && !same((before as unknown as Record<string, unknown>)[key], after[key]))
      return false;
    if (had !== has && before.status === after.status) return false;
  }
  return true;
}

/** The fields a hook may change have the right types. */
function hasShape(after: Record<string, unknown>): boolean {
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
    default:
      return typeof after.code === "string" && after.code !== "";
  }
}

/** True when the model would see other view text or other parts. */
function viewChanged(before: ReadOutcome, after: ReadOutcome): boolean {
  if (before.status === "ok" && after.status === "ok") {
    const lines = (outcome: typeof before) =>
      outcome.view.lines.map((line) => [line.number, line.text]);
    return !same(lines(before), lines(after));
  }
  if (before.status === "media" && after.status === "media")
    return !same(before.parts, after.parts);
  return false;
}

/** The view text, joined as the scanner joins it for the first viewId. */
function viewText(outcome: Extract<ReadOutcome, { status: "ok" }>): string {
  return outcome.view.lines.map((line) => line.text).join("\n");
}
