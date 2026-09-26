import type { FileSystem } from "@better-fs-tools/fs";

import type { PathResolver, ResolveContext } from "../contract/extensions.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { ReadNote } from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import { extensionId } from "./extension-error.ts";
import { isRecord } from "./input.ts";
import { isNote } from "./outcomes.ts";

export type ResolvedPath =
  | {
      readonly kind: "path";
      /** The path string that goes into the one fs.open(). */
      readonly path: string;
      /** The requested path when the resolver changed it, else null. */
      readonly resolvedFrom: string | null;
      readonly note: ReadNote | null;
    }
  | { readonly kind: "not-found"; readonly note: ReadNote | null };

/**
 * Runs the resolver on the requested path. The resolver only changes the path
 * string: it cannot open, and it gets one listing through `ctx.list`. A throw
 * or a malformed outcome gives EXTENSION_FAILED. A failure held by the listing
 * (an authorizer throw) wins over what the resolver did with it.
 */
export async function resolvePath<THost>(
  resolver: PathResolver<THost> | null,
  request: ReadRequest,
  fs: FileSystem,
  scope: CallScope<THost>,
): Promise<ResolvedPath> {
  if (resolver === null)
    return { kind: "path", path: request.path, resolvedFrom: null, note: null };
  const ctx: ResolveContext<THost> = {
    ...scope.hookContext(),
    paths: fs.paths,
    list: (dir) => scope.list("resolver", dir),
  };
  let outcome: unknown;
  try {
    outcome = await resolver.resolve(request.path, ctx);
  } catch (error) {
    scope.checkAbort();
    scope.throwHeld();
    throw scope.extensionFailure("resolve", extensionId(resolver, error));
  }
  scope.checkAbort();
  scope.throwHeld();
  const malformed = () => scope.extensionFailure("resolve", extensionId(resolver));
  if (!isRecord(outcome)) throw malformed();
  const { note } = outcome;
  if (note !== undefined && !isNote(note)) throw malformed();
  if (outcome.kind === "not-found") return { kind: "not-found", note: note ?? null };
  const { path } = outcome;
  if (outcome.kind !== "path" || !isPath(path)) throw malformed();
  return {
    kind: "path",
    path,
    resolvedFrom: path === request.path ? null : request.path,
    note: note ?? null,
  };
}

/** The same rule parseReadInput applies to the requested path. */
function isPath(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !value.includes("\0");
}
