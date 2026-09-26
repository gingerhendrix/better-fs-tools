import type { FileSystem, OpenFile } from "@better-fs-tools/fs";

import type { ReadContext } from "../contract/context.ts";
import type { Dependencies } from "../contract/deps.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { FileInfo, ReadNote, ReadOutcome, ReadResult } from "../contract/result.ts";
import { authorizeRead } from "./authorize.ts";
import { CallScope } from "./call-scope.ts";
import { classifySample, encodingRefusal } from "./classify.ts";
import { AbortReadError, ByteCursor } from "./cursor.ts";
import { formatResult } from "./format.ts";
import { parseReadInput } from "./input.ts";
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

/** One read, start to end. This file holds the stage order only. */
export async function runRead<THost>(
  deps: Dependencies<THost>,
  input: unknown,
  call: ReadContext<THost>,
): Promise<ReadResult> {
  return formatResult(deps, call, await readOutcome(deps, input, call));
}

async function readOutcome<THost>(
  deps: Dependencies<THost>,
  input: unknown,
  call: ReadContext<THost>,
): Promise<ReadOutcome> {
  let request: ReadRequest;
  try {
    request = parseReadInput(input, deps.limits);
  } catch (error) {
    return invalidInput(deps.messages, input, error);
  }

  const scope = new CallScope(deps, request, call);
  // A resolver note travels with every outcome after the resolve stage, and
  // stays last. Allow notes from the authorizer come just before it.
  let resolveNote: ReadNote | null = null;
  const finish = (outcome: ReadOutcome): ReadOutcome =>
    withNotes(
      outcome,
      resolveNote === null ? scope.allowNotes : [...scope.allowNotes, resolveNote],
    );
  try {
    scope.checkAbort();
    scope.enter("open");
    const fs = scope.fileSystem();

    scope.enter("resolve");
    const resolved = await resolvePath(deps.resolve, request, fs, scope);
    resolveNote = resolved.note;
    if (resolved.kind === "not-found") {
      return finish(await missOutcome(deps, request, fs, scope, request.path, null));
    }

    scope.enter("open");
    const handle = await openFile(deps, fs, request, resolved.path, scope);
    let outcome: ReadOutcome;
    try {
      const file = fileInfo(fs, request, handle.info, resolved.resolvedFrom);
      await authorizeRead(deps.authorize, request, file, scope);
      outcome = finish(await readOpenFile(deps, fs, request, file, handle, scope));
    } finally {
      // Cleanup is unconditional: EOF, scan limit, abort, denial, refusal, or adapter defect.
      await handle.close().catch(() => {});
    }
    await recordOutcome(scope, outcome);
    return outcome;
  } catch (error) {
    if (error instanceof ReadStop) return finish(error.outcome);
    if (error instanceof AbortReadError)
      return finish(aborted(deps.messages, request, scope.phase));
    return finish(ioError(deps.messages, request, error));
  }
}

function withNotes(outcome: ReadOutcome, notes: readonly ReadNote[]): ReadOutcome {
  return notes.length === 0 ? outcome : { ...outcome, notes: [...outcome.notes, ...notes] };
}

async function readOpenFile<THost>(
  deps: Dependencies<THost>,
  fs: FileSystem,
  request: ReadRequest,
  file: FileInfo,
  handle: OpenFile,
  scope: CallScope<THost>,
): Promise<ReadOutcome> {
  const { limits, messages, classifiers } = deps;
  const cursor = new ByteCursor(handle.bytes());
  try {
    scope.enter("sampling");
    const sample = await takeSample(cursor, limits, file, scope);
    if (sample.complete) checkSize(messages, request, file, sample.bytes.byteLength);

    const decision = classifySample(classifiers, sample);
    if (decision === null) return unsupportedBackend(messages, request, file, null);
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
      decision: { classifier: decision.classifier, classification: decision.classification },
      scan,
    });
  } finally {
    await cursor.close();
  }
}
