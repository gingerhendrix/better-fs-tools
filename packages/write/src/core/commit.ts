import type { MutatedFile, Precondition, WritableFileSystem } from "@better-fs-tools/fs";
import type { Note } from "@better-fs-tools/read";

import type { FileChange } from "../contract/result.ts";
import { hashBytes } from "./bytes.ts";
import { newFileMode } from "./hooks.ts";
import { isRecord } from "./input.ts";
import { isBackendError, messageOf } from "./outcomes.ts";
import type { Planned, ResolvedTarget } from "./planned.ts";
import type { MutationScope } from "./scope.ts";
import { ioFailure, statTarget } from "./target.ts";

export async function commitOne<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  planned: Planned,
  bytes: Uint8Array,
): Promise<MutatedFile> {
  scope.enter("commit");
  scope.checkAbort();
  const { target, precondition, createParents } = planned;
  if (!fs.writeCapabilities.compareAndSwap) {
    await checkBeforeCommit(scope, fs, target, precondition);
  }
  const mode = planned.loaded === null ? newFileMode(scope, planned.change) : null;
  scope.startCommit();
  let outcome: unknown;
  try {
    outcome = await fs.write(target.resolvedPath, bytes, {
      precondition,
      createParents,
      ...(mode === null ? {} : { mode }),
    });
  } catch (error) {
    throw ioFailure(scope, target.requestedPath, messageOf(error));
  }
  if (isRecord(outcome) && outcome.ok === false && isBackendError(outcome.error)) {
    throw scope.backendFailure(target.requestedPath, outcome.error);
  }
  if (!isRecord(outcome) || outcome.ok !== true || !isMutatedFile(outcome.file)) {
    throw ioFailure(scope, target.requestedPath, "malformed write outcome");
  }
  addCapabilityNotes(scope, fs, planned, outcome.file);
  return outcome.file;
}

export async function checkBeforeCommit<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  target: ResolvedTarget,
  precondition: Precondition,
): Promise<void> {
  const stat = await statTarget(
    scope,
    fs,
    { requestedPath: target.requestedPath, path: target.resolvedPath },
    "commit",
  );
  const { messages } = scope.deps;
  const path = target.requestedPath;
  if (precondition.kind === "absent" && stat.exists) {
    throw scope.stop("EXISTS", messages.exists({ tool: scope.tool, path }));
  }
  if (precondition.kind === "version" && (!stat.exists || stat.version !== precondition.version)) {
    throw scope.stop("STALE", messages.stale({ tool: scope.tool, path }));
  }
}

export function addCapabilityNotes<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  planned: Planned,
  file: MutatedFile,
): void {
  const { messages } = scope.deps;
  const capabilities = fs.writeCapabilities;
  const backend = fs.id;
  const add = (note: Note) => {
    if (!scope.notes.some((existing) => existing.code === note.code)) scope.notes.push(note);
  };
  if (!capabilities.atomic || !file.atomic) {
    add({ code: "not-atomic", severity: "warning", message: messages.notAtomic({ backend }) });
  }
  if (!capabilities.compareAndSwap) {
    add({
      code: "no-compare-and-swap",
      severity: "info",
      message: messages.noCompareAndSwap({ backend }),
    });
  }
  const replacesExistingFile = planned.precondition.kind !== "absent";
  if (!capabilities.preserveMode && replacesExistingFile) {
    add({ code: "mode-not-kept", severity: "info", message: messages.modeNotKept({ backend }) });
  }
  if (file.createdDirectories.length > 0) {
    const paths = file.createdDirectories;
    scope.notes.push({
      code: "directories-created",
      severity: "info",
      message: messages.directoriesCreated({ paths }),
      data: { paths: [...paths] },
    });
  }
}

export function fileChange<THost>(
  scope: MutationScope<THost>,
  planned: Planned,
  bytes: Uint8Array,
  file: MutatedFile,
): FileChange {
  const { change, loaded, target } = planned;
  const { digest } = scope.deps;
  return {
    kind: change.kind,
    path: target.displayPath,
    requestedPath: target.requestedPath,
    resolvedPath: target.resolvedPath,
    movedFrom: null,
    before:
      loaded === null
        ? null
        : { contentId: loaded.contentId, version: loaded.version, bytes: loaded.bytes.byteLength },
    after: {
      contentId: digest === null ? null : hashBytes(digest, bytes),
      version: file.version,
      bytes: bytes.byteLength,
    },
    linesAdded: change.linesAdded,
    linesRemoved: change.linesRemoved,
    diff: change.diff,
    diffTruncated: planned.diffTruncated,
    matches: planned.matches,
    snippets: planned.snippets,
    userModified: planned.userModified,
    createdDirectories: [...file.createdDirectories],
  };
}

export function isMutatedFile(value: unknown): value is MutatedFile {
  return (
    isRecord(value) &&
    typeof value.resolvedPath === "string" &&
    (value.version === null || typeof value.version === "string") &&
    Array.isArray(value.createdDirectories) &&
    typeof value.atomic === "boolean"
  );
}
