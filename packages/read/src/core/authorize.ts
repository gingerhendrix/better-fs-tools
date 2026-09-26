import type { ListOutcome } from "@better-fs-tools/fs";

import type { Authorizer, AuthorizeTarget } from "../contract/extensions.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { FileInfo, ReadNote } from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import { AbortReadError, raceAbort } from "./cursor.ts";
import { extensionId } from "./extension-error.ts";
import { isRecord } from "./input.ts";
import { ReadStop, denied, isNote } from "./outcomes.ts";

type Authorization =
  | { readonly allow: true }
  | { readonly allow: false; readonly note: ReadNote | null };

/**
 * `action: "read"`, after open() succeeds and before any content byte is read.
 * A denial gives DENIED. The pipeline closes the handle in its finally block,
 * on a denial, a throw, and an abort alike.
 */
export async function authorizeRead<THost>(
  authorizer: Authorizer<THost> | null,
  request: ReadRequest,
  file: FileInfo,
  scope: CallScope<THost>,
): Promise<void> {
  if (authorizer === null) return;
  scope.enter("authorize");
  const target: AuthorizeTarget = Object.freeze({
    action: "read",
    requestedPath: request.path,
    resolvedPath: file.resolvedPath,
    displayPath: file.displayPath,
    size: file.size,
    mtimeMs: file.mtimeMs,
  });
  const result = await runAuthorizer(authorizer, target, scope);
  if (!result.allow) throw new ReadStop(denied(scope.deps.messages, request, result.note));
}

/**
 * `action: "list"`, before an fs.list, in the phase of the stage that lists.
 * Returns null to go on, or the error outcome the listing gives. Never throws:
 * an authorizer failure is held on the scope for the stage to raise, and an
 * abort becomes an aborted outcome that the stage's abort check turns into
 * ABORTED.
 */
export async function authorizeList<THost>(
  authorizer: Authorizer<THost> | null,
  request: ReadRequest,
  dir: string,
  display: string,
  scope: CallScope<THost>,
): Promise<ListOutcome | null> {
  if (authorizer === null) return null;
  const target: AuthorizeTarget = Object.freeze({
    action: "list",
    requestedPath: request.path,
    resolvedPath: dir,
    displayPath: display,
    size: null,
    mtimeMs: null,
  });
  try {
    const result = await runAuthorizer(authorizer, target, scope);
    if (result.allow) return null;
    return { ok: false, error: { reason: "denied", detail: "refused by the authorizer" } };
  } catch (error) {
    if (error instanceof AbortReadError) return { ok: false, error: { reason: "aborted" } };
    if (!(error instanceof ReadStop)) throw error;
    scope.hold(error);
    return { ok: false, error: { reason: "io", detail: "the authorizer failed" } };
  }
}

/**
 * One authorizer call, raced against the signal. Allow notes go on the scope,
 * and the pipeline keeps them on the outcome. A throw or a malformed decision
 * gives EXTENSION_FAILED. An abort throws AbortReadError.
 */
async function runAuthorizer<THost>(
  authorizer: Authorizer<THost>,
  target: AuthorizeTarget,
  scope: CallScope<THost>,
): Promise<Authorization> {
  let decision: unknown;
  try {
    decision = await raceAbort(
      () => authorizer.authorize(target, scope.hookContext()),
      scope.signal,
    );
  } catch (error) {
    scope.checkAbort();
    throw scope.extensionFailure("authorize", extensionId(authorizer, error));
  }
  scope.checkAbort();
  const malformed = () => scope.extensionFailure("authorize", extensionId(authorizer));
  if (!isRecord(decision)) throw malformed();
  if (decision.allow === true) {
    const { notes } = decision;
    if (notes === undefined) return { allow: true };
    if (!Array.isArray(notes) || !notes.every(isNote)) throw malformed();
    scope.allowNotes.push(...notes);
    return { allow: true };
  }
  if (decision.allow !== false) throw malformed();
  const { note } = decision;
  if (note !== undefined && !isNote(note)) throw malformed();
  return { allow: false, note: note ?? null };
}
