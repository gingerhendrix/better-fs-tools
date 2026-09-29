import type { FileSystem, OpenFile } from "@better-fs-tools/fs";

import type { ReadContext } from "../contract/context.ts";
import type { ReadDependencies } from "../contract/deps.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { FileInfo, ReadNote, ReadReport, ReadResult } from "../contract/result.ts";
import { authorizeRead } from "./authorize.ts";
import { CallScope } from "./call-scope.ts";
import { classificationInfo, classifySample, encodingRefusal } from "./classify.ts";
import { convertFile, selectFileConverter } from "./convert.ts";
import { AbortReadError, ByteCursor } from "./cursor.ts";
import { convertDirectory } from "./directory.ts";
import { formatResult } from "./format.ts";
import { runHooks } from "./hooks.ts";
import { clampedLimit, parseReadInput } from "./input.ts";
import { fileInfo, openFile } from "./open.ts";
import {
  ReadStop,
  aborted,
  invalidInput,
  ioError,
  unsupportedBackend,
  unsupportedOutcome,
} from "./outcomes.ts";
import { recordOutcome } from "./record.ts";
import { resolvePath } from "./resolve.ts";
import { takeSample } from "./sample.ts";
import { scanText } from "./scan.ts";
import { missOutcome } from "./suggest.ts";
import { textOutcome } from "./text-outcome.ts";
import { checkSize, verifyHandle } from "./verify.ts";

export async function runRead<THost>(
  deps: ReadDependencies<THost>,
  input: unknown,
  call: ReadContext<THost>,
): Promise<ReadResult> {
  return formatResult(deps, call, await readOutcome(deps, input, call));
}

async function readOutcome<THost>(
  deps: ReadDependencies<THost>,
  input: unknown,
  call: ReadContext<THost>,
): Promise<ReadReport> {
  let request: ReadRequest;
  try {
    request = parseReadInput(input, deps.limits);
  } catch (error) {
    return invalidInput(deps.messages, input, error);
  }

  const scope = new CallScope(deps, request, call);
  const clampNote = clampedLimitNote(deps, input, request);
  let resolveNote: ReadNote | null = null;
  const finish = (outcome: ReadReport): ReadReport =>
    withNotes(outcome, [
      ...(clampNote === null ? [] : [clampNote]),
      ...scope.allowNotes,
      ...(resolveNote === null ? [] : [resolveNote]),
    ]);
  let outcome: ReadReport;
  try {
    outcome = await readStages(deps, request, scope, (note) => {
      resolveNote = note;
    });
  } catch (error) {
    outcome = outcomeFromError(deps, request, scope, error);
  }
  outcome = finish(outcome);
  if (isAborted(outcome)) return outcome;
  try {
    const hooked = await runHooks(scope, outcome);
    await recordOutcome(scope, hooked);
    return hooked;
  } catch (error) {
    return finish(outcomeFromError(deps, request, scope, error));
  }
}

async function readStages<THost>(
  deps: ReadDependencies<THost>,
  request: ReadRequest,
  scope: CallScope<THost>,
  onResolveNote: (note: ReadNote | null) => void,
): Promise<ReadReport> {
  scope.checkAbort();
  scope.enter("open");
  const fs = scope.fileSystem();

  scope.enter("resolve");
  const resolved = await resolvePath(deps.resolve, request, fs, scope);
  onResolveNote(resolved.note);
  if (resolved.kind === "not-found") {
    return missOutcome(deps, request, fs, scope, request.path, null);
  }

  scope.enter("open");
  const opened = await openFile(deps, fs, request, resolved.path, scope);
  if (opened.kind === "directory") {
    const { error, converter } = opened;
    return convertDirectory({
      fs,
      request,
      openedPath: resolved.path,
      error,
      resolvedFrom: resolved.resolvedFrom,
      converter,
      scope,
    });
  }
  const { handle } = opened;
  try {
    const file = fileInfo(fs, request, handle.info, resolved.resolvedFrom);
    await authorizeRead(deps.authorize, request, file, scope);
    return await readOpenFile(deps, fs, request, file, handle, scope);
  } finally {
    await handle.close().catch(() => {});
  }
}

function outcomeFromError<THost>(
  deps: ReadDependencies<THost>,
  request: ReadRequest,
  scope: CallScope<THost>,
  error: unknown,
): ReadReport {
  if (error instanceof ReadStop) return error.outcome;
  if (error instanceof AbortReadError) return aborted(deps.messages, request, scope.phase);
  return ioError(deps.messages, request, scope.phase, error);
}

function clampedLimitNote<THost>(
  deps: ReadDependencies<THost>,
  input: unknown,
  request: ReadRequest,
): ReadNote | null {
  const requested = clampedLimit(input, request);
  if (requested === null) return null;
  const max = deps.limits.maxLines;
  return {
    code: "clamped",
    severity: "info",
    message: deps.messages.limitClamped({ requested, max }),
    data: { param: "limit", requested, max },
  };
}

function isAborted(outcome: ReadReport): boolean {
  return outcome.status === "error" && outcome.error.code === "ABORTED";
}

function withNotes(outcome: ReadReport, notes: readonly ReadNote[]): ReadReport {
  return notes.length === 0 ? outcome : { ...outcome, notes: [...outcome.notes, ...notes] };
}

async function readOpenFile<THost>(
  deps: ReadDependencies<THost>,
  fs: FileSystem,
  request: ReadRequest,
  file: FileInfo,
  handle: OpenFile,
  scope: CallScope<THost>,
): Promise<ReadReport> {
  const { limits, messages, classifiers } = deps;
  const cursor = new ByteCursor(handle.bytes());
  try {
    scope.enter("sampling");
    const sample = await takeSample(cursor, limits, file, scope);
    if (sample.complete) checkSize(messages, request, file, sample.bytes.byteLength);

    const decision = classifySample(classifiers, sample);
    if (decision === null) return unsupportedBackend(messages, request, "sampling", file, null);
    const converter = selectFileConverter(scope, decision, sample);
    if (converter !== null) {
      return await convertFile({
        deps,
        fs,
        request,
        file,
        handle,
        cursor,
        sample,
        decision,
        converter,
        scope,
      });
    }
    if (decision.classification.kind === "unsupported") {
      return unsupportedOutcome(request, file, decision.classifier, decision.classification);
    }

    scope.enter("scan");
    const scan = await scanText({ cursor, sample, request, limits, digest: deps.digest, scope });
    if (scan.kind === "invalid-utf8") {
      const refusal = encodingRefusal(classifiers, sample);
      if (refusal === null) {
        return unsupportedBackend(
          messages,
          request,
          "scan",
          file,
          "invalid utf-8 with no encoding refusal",
        );
      }
      return unsupportedOutcome(request, file, refusal.classifier, refusal.classification);
    }

    scope.enter("verification");
    if (scan.reachedEof) checkSize(messages, request, file, scan.scannedBytes);
    await verifyHandle(handle, messages, request, file, scope);

    return textOutcome({
      deps,
      fs,
      request,
      file,
      classification: classificationInfo(decision),
      conversion: null,
      scan,
      contentId: scan.contentId,
      notes: decision.classification.notes ?? [],
    });
  } finally {
    await cursor.close();
  }
}
