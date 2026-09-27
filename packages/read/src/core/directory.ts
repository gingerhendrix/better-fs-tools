import type { FileSystem, ListOutcome, NotAFileError } from "@better-fs-tools/fs";

import type { DirectoryConverter, DirectoryConvertInput } from "../contract/extensions.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { ClassificationInfo, FileInfo, ReadOutcome } from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import {
  checkConvertOutcome,
  firstMediaType,
  mediaBytes,
  refusedOutcome,
  scanConvertedText,
  tooLarge,
} from "./converted.ts";
import { AbortReadError, raceAbort } from "./cursor.ts";
import { extensionId } from "./extension-error.ts";
import { ReadStop, fromFileSystemError } from "./outcomes.ts";
import { textOutcome } from "./text-outcome.ts";

const DIRECTORY: ClassificationInfo = Object.freeze({
  kind: "directory",
  classifier: "fs",
  code: null,
  mimeType: null,
  confidence: "high",
  reasons: Object.freeze(["directory"]),
});

/** The first directory converter, when the backend can list. Else null: the read gives NOT_A_FILE. */
export function directoryConverter<THost>(
  scope: CallScope<THost>,
  fs: FileSystem,
): DirectoryConverter<THost> | null {
  if (typeof fs.list !== "function") return null;
  for (const converter of scope.deps.converters) {
    if (converter.target === "directory") return converter;
  }
  return null;
}

export interface ConvertDirectoryInput<THost> {
  readonly fs: FileSystem;
  readonly request: ReadRequest;
  /** The lexical path that went into open(). */
  readonly path: string;
  readonly error: NotAFileError;
  readonly resolvedFrom: string | null;
  readonly converter: DirectoryConverter<THost>;
  readonly scope: CallScope<THost>;
}

/**
 * Runs the directory converter. Its list() is the read's one listing after
 * open, through CallScope.list, so authorize with action "list" runs first.
 * The target paths come from open(). A backend that gives target null (a
 * virtual adapter's EISDIR) gets the lexical path. A failed listing ends the
 * read with that failure. Directories have no handle, so no change detection
 * and no observation.
 */
export async function convertDirectory<THost>(
  input: ConvertDirectoryInput<THost>,
): Promise<ReadOutcome> {
  const { fs, request, path, error, converter, scope } = input;
  const { limits, messages } = scope.deps;
  const dir = error.target?.resolvedPath ?? path;
  const file: FileInfo = {
    requestedPath: request.path,
    resolvedPath: dir,
    displayPath: error.target?.displayPath ?? path,
    backend: fs.id,
    size: null,
    mtimeMs: null,
    identity: null,
    mimeType: null,
    resolvedFrom: input.resolvedFrom,
    version: null,
  };

  let listing: ListOutcome | null = null;
  const convertInput: DirectoryConvertInput = Object.freeze({
    path,
    target: error.target,
    async list() {
      const listed = await scope.list("open", dir, file.displayPath);
      listing ??= listed;
      return listed;
    },
  });

  /** Abort, a held authorizer failure, then a failed listing: each wins over what the converter did. */
  const settle = (): void => {
    scope.checkAbort();
    scope.throwHeld();
    const listed: ListOutcome | null = listing;
    if (listed !== null && !listed.ok) {
      throw new ReadStop(fromFileSystemError(messages, request, listed.error, scope.phase));
    }
  };
  const failed = (thrown?: unknown): ReadStop => {
    settle();
    return scope.extensionFailure("converters", extensionId(converter, thrown));
  };

  scope.enter("conversion");
  let produced: unknown;
  try {
    produced = await raceAbort(
      () => converter.convert(convertInput, scope.hookContext()),
      scope.signal,
    );
  } catch (thrown) {
    throw failed(thrown);
  }
  settle();
  const outcome = checkConvertOutcome(produced);
  if (outcome === null) throw failed();
  if (outcome.kind === "refuse") {
    return refusedOutcome(request, file, DIRECTORY, outcome.code, outcome.note);
  }
  if (outcome.kind === "media") {
    if (mediaBytes(outcome.parts) > limits.maxMediaBytes) {
      return tooLarge(messages, request, file, DIRECTORY, "media", limits.maxMediaBytes);
    }
    return {
      status: "media",
      request,
      file,
      classification: DIRECTORY,
      conversion: { converter: converter.id, mimeType: firstMediaType(outcome.parts) },
      parts: outcome.parts,
      observation: null,
      notes: outcome.notes ?? [],
    };
  }

  let scan;
  try {
    scan = await scanConvertedText(outcome.text, request, file, scope);
  } catch (thrown) {
    if (thrown instanceof ReadStop || thrown instanceof AbortReadError) throw thrown;
    throw failed(thrown);
  }
  return textOutcome({
    deps: scope.deps,
    fs: null,
    request,
    file,
    classification: DIRECTORY,
    conversion: { converter: converter.id, mimeType: outcome.mimeType },
    scan,
    contentId: null,
    notes: outcome.notes ?? [],
  });
}
