import type { ListOutcome, WritableFileSystem } from "@better-fs-tools/fs";
import type { Note, ToolResolveContext } from "@better-fs-tools/read";

import type { MutationScope } from "./scope.ts";
import { AbortStop } from "./abort.ts";
import { extensionId } from "./extension-error.ts";
import { isPath, isRecord } from "./input.ts";
import { isNote, messageOf } from "./outcomes.ts";

/** Entries one resolver listing may return. The read tool's default maxDirectoryEntries. */
const LIST_LIMIT = 200;

/**
 * Runs the resolver on one requested path. The resolver only changes the path
 * string. It gets one listing through `ctx.list` for this path. A not-found
 * outcome ends the call with NOT_FOUND. A throw or a malformed outcome gives
 * EXTENSION_FAILED. A resolver note joins the call's notes.
 */
export async function resolvePath<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  requested: string,
): Promise<string> {
  const resolver = scope.deps.resolve;
  if (resolver === null) return requested;
  scope.checkAbort();
  let listed = false;
  const ctx: ToolResolveContext<THost> = {
    ...scope.hookContext(),
    paths: fs.paths,
    list: async (dir: string): Promise<ListOutcome> => {
      if (listed) return { ok: false, error: { reason: "denied", detail: "listing budget spent" } };
      listed = true;
      return listOnce(scope, fs, dir);
    },
  };
  let outcome: unknown;
  try {
    outcome = await scope.race(() => resolver.resolve(requested, ctx));
  } catch (error) {
    if (error instanceof AbortStop) throw error;
    throw scope.extensionFailure("resolve", extensionId(resolver, error));
  }
  const malformed = () => scope.extensionFailure("resolve", extensionId(resolver));
  if (!isRecord(outcome)) throw malformed();
  const { note } = outcome;
  if (note !== undefined && !isNote(note)) throw malformed();
  if (outcome.kind === "not-found") {
    if (note !== undefined) scope.notes.push(note as Note);
    const { messages } = scope.deps;
    throw scope.stop("NOT_FOUND", messages.notFound({ tool: scope.tool, path: requested }));
  }
  const { path } = outcome;
  if (outcome.kind !== "path" || !isPath(path)) throw malformed();
  if (note !== undefined) scope.notes.push(note as Note);
  return path;
}

/**
 * One bounded fs.list. Never throws: a missing list(), an abort, or a
 * throwing backend becomes an error outcome. The write tools have no "list"
 * authorize action. The path the resolver returns is authorized in the
 * access stage like any other.
 */
async function listOnce<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  dir: string,
): Promise<ListOutcome> {
  if (typeof fs.list !== "function") {
    return { ok: false, error: { reason: "unsupported", detail: "the backend cannot list" } };
  }
  const { signal } = scope;
  try {
    return await fs.list(
      dir,
      signal === undefined ? { limit: LIST_LIMIT } : { limit: LIST_LIMIT, signal },
    );
  } catch (error) {
    return { ok: false, error: { reason: "io", detail: messageOf(error) } };
  }
}
