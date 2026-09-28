import type { Note } from "@better-fs-tools/read";

import type { PlannedChange, WriteAuthorizeTarget } from "../contract/extensions.ts";
import { AbortStop } from "./abort.ts";
import { extensionId } from "./extension-error.ts";
import { isRecord } from "./input.ts";
import { errorNote, hostErrorNote, isNote, isNoteList } from "./outcomes.ts";
import type { ResolvedTarget } from "./planned.ts";
import type { MutationScope } from "./scope.ts";

export interface AccessRequest {
  readonly action: WriteAuthorizeTarget["action"];
  readonly target: ResolvedTarget;
}

/**
 * The access stage: one call for each target in order, with `change: null`
 * and an empty plan, before any content byte is read. A denial gives DENIED.
 */
export async function authorizeAccess<THost>(
  scope: MutationScope<THost>,
  requests: readonly AccessRequest[],
): Promise<void> {
  if (scope.deps.authorize === null) return;
  scope.enter("authorize");
  for (const { action, target } of requests) {
    const content = await runAuthorizer(scope, {
      action,
      tool: scope.tool,
      requestedPath: target.requestedPath,
      resolvedPath: target.resolvedPath,
      displayPath: target.displayPath,
      change: null,
      plan: [],
    });
    // Content has no meaning before a change is planned.
    if (content !== null) throw malformed(scope);
  }
}

/**
 * The change stage: one call for each planned change in order, with the whole
 * plan. Returns the W6 content for each change, or null. Content is valid for
 * edit and write only: for apply_patch it gives EXTENSION_FAILED.
 */
export async function authorizeChanges<THost>(
  scope: MutationScope<THost>,
  plan: readonly PlannedChange[],
): Promise<(string | null)[]> {
  const contents: (string | null)[] = plan.map(() => null);
  if (scope.deps.authorize === null) return contents;
  scope.enter("authorize");
  const frozen = Object.freeze([...plan]);
  for (const [index, change] of frozen.entries()) {
    const content = await runAuthorizer(scope, {
      action: change.kind,
      tool: scope.tool,
      requestedPath: change.requestedPath,
      resolvedPath: change.resolvedPath,
      displayPath: change.displayPath,
      change,
      plan: frozen,
    });
    if (content !== null && scope.tool === "apply_patch") throw malformed(scope);
    contents[index] = content;
  }
  return contents;
}

/**
 * One authorizer call, raced against the signal. Allow notes join the call's
 * notes. Returns the allow decision's content, or null. A denial gives
 * DENIED with the authorizer's message when it gave a note. A throw or a
 * malformed decision gives EXTENSION_FAILED.
 */
async function runAuthorizer<THost>(
  scope: MutationScope<THost>,
  target: WriteAuthorizeTarget,
): Promise<string | null> {
  const authorizer = scope.deps.authorize;
  if (authorizer === null) return null;
  scope.checkAbort();
  const frozen = Object.freeze(target);
  let decision: unknown;
  try {
    decision = await scope.race(() => authorizer.authorize(frozen, scope.hookContext()));
  } catch (error) {
    if (error instanceof AbortStop) throw error;
    throw scope.extensionFailure("authorize", extensionId(authorizer, error));
  }
  if (!isRecord(decision)) throw malformed(scope);
  if (decision.allow === true) {
    const { notes, content } = decision;
    if (notes !== undefined && !isNoteList(notes)) throw malformed(scope);
    if (content !== undefined && typeof content !== "string") throw malformed(scope);
    if (notes !== undefined) scope.notes.push(...notes);
    return content ?? null;
  }
  if (decision.allow !== false) throw malformed(scope);
  const { note } = decision;
  if (note !== undefined && !isNote(note)) throw malformed(scope);
  throw scope.stopWith(deniedNote(scope, target, note));
}

function deniedNote<THost>(
  scope: MutationScope<THost>,
  target: WriteAuthorizeTarget,
  note: Note | undefined,
): Note {
  if (note !== undefined) return hostErrorNote("DENIED", note);
  const message = scope.deps.messages.denied({ path: target.requestedPath, detail: null });
  return errorNote("DENIED", message);
}

function malformed<THost>(scope: MutationScope<THost>) {
  return scope.extensionFailure("authorize", extensionId(scope.deps.authorize));
}
