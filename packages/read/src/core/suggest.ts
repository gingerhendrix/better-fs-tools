import type { FileSystem, FileSystemError } from "@better-fs-tools/fs";

import type { ReadDependencies } from "../contract/deps.ts";
import type { Suggest } from "../contract/extensions.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { ReadFailure } from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import { errorData, notFound } from "./outcomes.ts";

/**
 * NOT_FOUND for the path that missed, with names from `suggest` over one
 * listing of its parent. A suggested name is never opened: the model must send
 * a new call. A throw or a malformed return from `suggest` gives
 * EXTENSION_FAILED. A failed or denied listing gives no suggestions.
 */
export async function missOutcome<THost>(
  deps: ReadDependencies<THost>,
  request: ReadRequest,
  fs: FileSystem,
  scope: CallScope<THost>,
  missed: string,
  error: FileSystemError | null,
): Promise<ReadFailure> {
  const data = error === null ? {} : errorData(error);
  const found =
    deps.suggest === null
      ? null
      : await suggestNames(deps.suggest, fs, scope, missed, deps.limits.maxSuggestions);
  scope.checkAbort();
  if (found === null) return notFound(deps.messages, request, [], data);
  const { suggestions, entriesTruncated } = found;
  return notFound(deps.messages, request, suggestions, {
    ...data,
    ...(suggestions.length === 0 ? {} : { suggestions: [...suggestions] }),
    ...(entriesTruncated ? { entriesTruncated } : {}),
  });
}

async function suggestNames<THost>(
  suggest: Suggest<THost>,
  fs: FileSystem,
  scope: CallScope<THost>,
  missed: string,
  max: number,
): Promise<{ suggestions: readonly string[]; entriesTruncated: boolean } | null> {
  const listed = await scope.list("open", fs.paths.dirname(missed));
  scope.throwHeld();
  if (!listed.ok) return null;
  let names: unknown;
  try {
    names = suggest({
      path: missed,
      name: fs.paths.basename(missed),
      entries: listed.entries,
      entriesTruncated: listed.truncated,
      max,
      call: scope.call,
    });
  } catch {
    scope.checkAbort();
    throw scope.extensionFailure("suggest");
  }
  if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
    throw scope.extensionFailure("suggest");
  }
  return { suggestions: names.slice(0, max), entriesTruncated: listed.truncated };
}
