import type { FileSystem, OpenFile } from "@better-fs-tools/fs";

import type { Classification, ClassificationSample } from "../contract/classify.ts";
import type { Dependencies } from "../contract/deps.ts";
import type { ConverterMatch, FileConverter, FileConvertInput } from "../contract/extensions.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { ClassificationInfo, FileInfo, ReadMedia, ReadOutcome } from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import { classificationInfo } from "./classify.ts";
import type { Decision } from "./classify.ts";
import { ConvertSource } from "./convert-source.ts";
import {
  checkConvertOutcome,
  firstMediaType,
  mediaBytes,
  refusedOutcome,
  scanConvertedText,
  tooLarge,
} from "./converted.ts";
import { AbortReadError, raceAbort } from "./cursor.ts";
import type { ByteCursor } from "./cursor.ts";
import { extensionId } from "./extension-error.ts";
import { capabilityNotes } from "./notes.ts";
import { buildObservation } from "./observation.ts";
import { ReadStop } from "./outcomes.ts";
import { textOutcome } from "./text-outcome.ts";
import { checkSize, verifyHandle } from "./verify.ts";

/**
 * The first file converter that accepts the match, in order, or null.
 * `accepts` is sync and the only place a converter may decline. A throw gives
 * EXTENSION_FAILED.
 */
export function selectFileConverter<THost>(
  scope: CallScope<THost>,
  decision: Decision<Classification>,
  sample: ClassificationSample,
): FileConverter<THost> | null {
  const match: ConverterMatch = Object.freeze({
    classification: decision.classification,
    classifier: decision.classifier,
    sample,
  });
  for (const converter of scope.deps.converters) {
    if (converter.target !== "file") continue;
    scope.enter("conversion");
    let accepted: unknown;
    try {
      accepted = converter.accepts(match);
    } catch (error) {
      throw scope.extensionFailure("converters", extensionId(converter, error));
    }
    if (accepted === true) return converter;
  }
  return null;
}

export interface ConvertFileInput<THost> {
  readonly deps: Dependencies<THost>;
  readonly fs: FileSystem;
  readonly request: ReadRequest;
  readonly file: FileInfo;
  readonly handle: OpenFile;
  readonly cursor: ByteCursor;
  readonly sample: ClassificationSample;
  readonly decision: Decision<Classification>;
  readonly converter: FileConverter<THost>;
  readonly scope: CallScope<THost>;
}

/**
 * Runs one file converter on the capped source stream, then reads what the
 * converter left, then runs the size check and handle.verify(). Text goes
 * through the LineScanner. Media over maxMediaBytes, or source over
 * maxConvertBytes (even when the converter caught the error), gives TOO_LARGE.
 * contentId hashes the source bytes.
 */
export async function convertFile<THost>(input: ConvertFileInput<THost>): Promise<ReadOutcome> {
  const { deps, request, file, handle, sample, decision, converter, scope } = input;
  const { limits, messages } = deps;
  const classification = classificationInfo(decision);
  const source = new ConvertSource(
    input.cursor,
    sample,
    limits.maxConvertBytes,
    deps.digest,
    scope,
  );

  /** Abort, then the cap, then a backend failure: each wins over what the converter did. */
  const settle = (): void => {
    scope.checkAbort();
    if (source.exceeded) {
      throw new ReadStop(
        tooLarge(messages, request, file, classification, "convert", limits.maxConvertBytes),
      );
    }
    if (source.failure !== null) throw source.failure;
  };
  const failed = (error?: unknown): ReadStop => {
    settle();
    return scope.extensionFailure("converters", extensionId(converter, error));
  };

  scope.enter("conversion");
  const convertInput: FileConvertInput = Object.freeze({
    info: handle.info,
    classification: decision.classification,
    sample,
    bytes: () => source.bytes(),
  });
  let produced: unknown;
  try {
    produced = await raceAbort(
      () => converter.convert(convertInput, scope.hookContext()),
      scope.signal,
    );
  } catch (error) {
    throw failed(error);
  }
  settle();
  const outcome = checkConvertOutcome(produced);
  if (outcome === null) throw failed();
  if (outcome.kind === "refuse") {
    return refusedOutcome(request, file, classification, outcome.code, outcome.note);
  }

  if (outcome.kind === "media") {
    if (mediaBytes(outcome.parts) > limits.maxMediaBytes) {
      return tooLarge(messages, request, file, classification, "media", limits.maxMediaBytes);
    }
    await finishSource(source, handle, input, settle);
    return mediaOutcome(input, classification, outcome.parts, outcome.notes ?? [], source);
  }

  let scan;
  try {
    scan = await scanConvertedText(outcome.text, request, file, scope);
  } catch (error) {
    if (error instanceof ReadStop || error instanceof AbortReadError) throw error;
    throw failed(error);
  }
  await finishSource(source, handle, input, settle);
  return textOutcome({
    deps,
    fs: input.fs,
    request,
    file,
    classification,
    conversion: { converter: converter.id, mimeType: outcome.mimeType },
    scan,
    contentId: source.contentId(),
    notes: outcome.notes ?? [],
  });
}

/** Drain, then the size check and handle.verify(): change detection covers conversions too. */
async function finishSource<THost>(
  source: ConvertSource<THost>,
  handle: OpenFile,
  input: ConvertFileInput<THost>,
  settle: () => void,
): Promise<void> {
  const { deps, request, file, scope } = input;
  try {
    await source.drain();
  } catch (error) {
    settle();
    throw error;
  }
  scope.enter("verification");
  checkSize(deps.messages, request, file, source.count);
  await verifyHandle(handle, deps.messages, request, file, scope);
}

function mediaOutcome<THost>(
  input: ConvertFileInput<THost>,
  classification: ClassificationInfo,
  parts: ReadMedia["parts"],
  notes: ReadMedia["notes"],
  source: ConvertSource<THost>,
): ReadMedia {
  const { deps, fs, request, file, converter } = input;
  return {
    status: "media",
    request,
    file,
    classification,
    conversion: { converter: converter.id, mimeType: firstMediaType(parts) },
    parts,
    observation: buildObservation(deps.digest, {
      file,
      contentId: source.contentId(),
      view: parts,
      observedAt: deps.clock().toISOString(),
      // The model saw media, not source text: nothing here backs a text edit.
      wholeFileVisible: false,
    }),
    notes: [...notes, ...capabilityNotes(fs, deps.messages)],
  };
}
