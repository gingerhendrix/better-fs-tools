import type {
  MutatedFile,
  MutationError,
  Precondition,
  StagedWrite,
  WritableFileSystem,
  WriteOptions,
} from "@better-fs-tools/fs";

import type { JsonObject } from "@better-fs-tools/read";

import type { CommitFileState, FileChange, WriteErrorCode } from "../contract/result.ts";
import { checkBeforeCommit, fileChange, isMutatedFile } from "./commit.ts";
import { isRecord } from "./input.ts";
import type { Loaded } from "./load.ts";
import { WriteStop, codeForReason, errorNote, failure, isBackendError } from "./outcomes.ts";
import { messageOf } from "./outcomes.ts";
import type { PatchChange } from "./plan-patch.ts";
import type { Planned, ResolvedTarget } from "./planned.ts";
import type { MutationScope } from "./scope.ts";
import { ioFailure } from "./target.ts";

export interface PatchStep {
  readonly change: PatchChange;
  readonly bytes: Uint8Array | null;
  readonly mode: number | null;
}

export interface PublishedStep {
  readonly step: PatchStep;
  readonly file: MutatedFile | null;
}

export interface PatchFile {
  readonly path: string;
  readonly resolvedPath: string;
}

type JournalEntry =
  | {
      readonly kind: "written";
      readonly step: PatchStep;
      readonly file: MutatedFile;
      readonly created: boolean;
    }
  | {
      readonly kind: "removed";
      readonly step: PatchStep;
      readonly target: ResolvedTarget;
      readonly loaded: Loaded;
    };

type Attempt =
  | { readonly ok: true; readonly file: MutatedFile }
  | { readonly ok: false; readonly code: WriteErrorCode };

interface PublishFailure {
  readonly target: ResolvedTarget;
  readonly code: WriteErrorCode;
}

export async function commitPatch<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  steps: readonly PatchStep[],
  files: readonly PatchFile[],
): Promise<PublishedStep[]> {
  scope.enter("commit");
  scope.checkAbort();
  scope.startCommit();
  const staged = await stageAll(scope, fs, steps);
  const journal: JournalEntry[] = [];
  for (const [index, step] of steps.entries()) {
    const failed = await publishStep(scope, fs, step, staged[index] ?? null, journal);
    if (failed === null) continue;
    await discardAll(staged);
    throw await rollback(scope, fs, journal, failed, files);
  }
  return steps.map((step) => {
    const entry = journal.find((item) => item.step === step && item.kind === "written");
    return { step, file: entry?.kind === "written" ? entry.file : null };
  });
}

async function stageAll<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  steps: readonly PatchStep[],
): Promise<(StagedWrite | null)[]> {
  const staged: (StagedWrite | null)[] = steps.map(() => null);
  if (typeof fs.stage !== "function") return staged;
  for (const [index, step] of steps.entries()) {
    if (step.bytes === null) continue;
    const { target } = step.change.planned;
    let outcome: unknown;
    try {
      outcome = await fs.stage(target.resolvedPath, step.bytes, writeOptions(step));
    } catch (error) {
      await discardAll(staged);
      throw ioFailure(scope, target.requestedPath, messageOf(error));
    }
    if (isRecord(outcome) && outcome.ok === false && isBackendError(outcome.error)) {
      await discardAll(staged);
      throw scope.backendFailure(target.requestedPath, outcome.error);
    }
    if (!isRecord(outcome) || outcome.ok !== true || !isStaged(outcome.staged)) {
      await discardAll(staged);
      throw ioFailure(scope, target.requestedPath, "malformed stage outcome");
    }
    staged[index] = outcome.staged;
  }
  return staged;
}

async function publishStep<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  step: PatchStep,
  staged: StagedWrite | null,
  journal: JournalEntry[],
): Promise<PublishFailure | null> {
  const { planned, source } = step.change;
  const { target, precondition } = planned;
  const bytes = step.bytes;
  if (bytes !== null) {
    const written = await attempt(scope, fs, target, precondition, () =>
      staged === null ? fs.write(target.resolvedPath, bytes, writeOptions(step)) : staged.publish(),
    );
    if (!written.ok) return { target, code: written.code };
    const created = precondition.kind === "absent";
    journal.push({ kind: "written", step, file: written.file, created });
  }
  const removed = source ?? (planned.change.kind === "delete" ? target : null);
  if (removed === null) return null;
  const loaded = planned.loaded as Loaded;
  const version: Precondition = { kind: "version", version: loaded.version };
  const outcome = await attemptRemove(scope, fs, removed, version);
  if (!outcome.ok) return { target: removed, code: outcome.code };
  journal.push({ kind: "removed", step, target: removed, loaded });
  return null;
}

async function rollback<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  journal: readonly JournalEntry[],
  failed: PublishFailure,
  files: readonly PatchFile[],
): Promise<WriteStop> {
  const states = new Map<string, Omit<CommitFileState, "path">>();
  states.set(failed.target.resolvedPath, { state: "unchanged", code: failed.code });
  const left: FileChange[] = [];
  for (const entry of [...journal].reverse()) {
    const outcome = await undo(scope, fs, entry);
    const key =
      entry.kind === "written"
        ? entry.step.change.planned.target.resolvedPath
        : entry.target.resolvedPath;
    if (outcome.ok) {
      states.set(key, { state: "restored" });
      continue;
    }
    states.set(key, { state: "rollback-failed", code: outcome.code });
    left.unshift(changeLeftAfterFailedRollback(scope, entry));
  }
  const rolledBack = left.length === 0;
  const report = files.map((file): CommitFileState => ({
    path: file.path,
    ...(states.get(file.resolvedPath) ?? { state: "unchanged" }),
  }));
  const { messages } = scope.deps;
  const path = failed.target.requestedPath;
  const code = rolledBack ? failed.code : "PARTIAL_COMMIT";
  const message = messages.patchCommitFailed({
    path,
    code: failed.code,
    rolledBack,
    files: report,
  });
  const data: JsonObject = rolledBack
    ? { path, rolledBack }
    : { path, cause: failed.code, rolledBack };
  const base = failure(scope.tool, "commit", errorNote(code, message, data));
  return new WriteStop({
    ...base,
    changes: left,
    commit: { rolledBack, files: report },
  });
}

async function undo<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  entry: JournalEntry,
): Promise<Attempt> {
  if (entry.kind === "removed") {
    const { target, loaded } = entry;
    const options: WriteOptions = {
      precondition: { kind: "absent" },
      createParents: true,
      ...(loaded.mode === null ? {} : { mode: loaded.mode }),
    };
    return attempt(scope, fs, target, options.precondition, () =>
      fs.write(target.resolvedPath, loaded.bytes, options),
    );
  }
  const { planned } = entry.step.change;
  const { target } = planned;
  const after: Precondition =
    entry.file.version === null
      ? { kind: "any" }
      : { kind: "version", version: entry.file.version };
  if (entry.created) return attemptRemove(scope, fs, target, after);
  const original = (planned.loaded as Loaded).bytes;
  return attempt(scope, fs, target, after, () =>
    fs.write(target.resolvedPath, original, { precondition: after, createParents: false }),
  );
}

function attemptRemove<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  target: ResolvedTarget,
  precondition: Precondition,
): Promise<Attempt> {
  const remove = fs.remove;
  if (typeof remove !== "function") {
    return Promise.resolve({ ok: false, code: "UNSUPPORTED_BACKEND" });
  }
  return attempt(scope, fs, target, precondition, () =>
    remove.call(fs, target.resolvedPath, { precondition }),
  );
}

async function attempt<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  target: ResolvedTarget,
  precondition: Precondition,
  run: () => Promise<unknown>,
): Promise<Attempt> {
  if (!fs.writeCapabilities.compareAndSwap && precondition.kind !== "any") {
    try {
      await checkBeforeCommit(scope, fs, target, precondition);
    } catch (error) {
      if (error instanceof WriteStop) return { ok: false, code: error.report.error.code };
      return { ok: false, code: "IO_ERROR" };
    }
  }
  let outcome: unknown;
  try {
    outcome = await run();
  } catch {
    return { ok: false, code: "IO_ERROR" };
  }
  if (isRecord(outcome) && outcome.ok === false && isBackendError(outcome.error)) {
    return { ok: false, code: codeForReason((outcome.error as MutationError).reason) };
  }
  if (!isRecord(outcome) || outcome.ok !== true || !isMutatedFile(outcome.file)) {
    return { ok: false, code: "IO_ERROR" };
  }
  return { ok: true, file: outcome.file };
}

function changeLeftAfterFailedRollback<THost>(
  scope: MutationScope<THost>,
  entry: JournalEntry,
): FileChange {
  const { planned } = entry.step.change;
  if (entry.kind === "removed") return deleteChange(planned, entry.target);
  const change = fileChange(scope, planned, entry.step.bytes as Uint8Array, entry.file);
  // Its move source was restored or never removed, so the destination is a create.
  return planned.change.kind === "move" ? { ...change, kind: "create", before: null } : change;
}

export function deleteChange(planned: Planned, target: ResolvedTarget): FileChange {
  const loaded = planned.loaded as Loaded;
  const isDelete = planned.change.kind === "delete";
  return {
    kind: "delete",
    path: target.displayPath,
    requestedPath: target.requestedPath,
    resolvedPath: target.resolvedPath,
    movedFrom: null,
    before: {
      contentId: loaded.contentId,
      version: loaded.version,
      bytes: loaded.bytes.byteLength,
    },
    after: null,
    linesAdded: 0,
    linesRemoved: isDelete ? planned.change.linesRemoved : lineCount(loaded.text),
    diff: isDelete ? planned.change.diff : "",
    diffTruncated: isDelete && planned.diffTruncated,
    matches: [],
    snippets: [],
    userModified: false,
    createdDirectories: [],
  };
}

function lineCount(text: string): number {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

function writeOptions(step: PatchStep): WriteOptions {
  const { precondition, createParents } = step.change.planned;
  return { precondition, createParents, ...(step.mode === null ? {} : { mode: step.mode }) };
}

async function discardAll(staged: readonly (StagedWrite | null)[]): Promise<void> {
  for (const write of staged) {
    if (write === null) continue;
    try {
      await write.discard();
    } catch {
      // A leftover staged file cannot change a target.
    }
  }
}

function isStaged(value: unknown): value is StagedWrite {
  return (
    isRecord(value) && typeof value.publish === "function" && typeof value.discard === "function"
  );
}
