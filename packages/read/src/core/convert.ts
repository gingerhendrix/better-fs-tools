import type { FileSystem, OpenFile } from "@better-fs-tools/fs";

import type { Classification, ClassificationSample } from "../contract/classify.ts";
import type { ReadDependencies } from "../contract/deps.ts";
import type { ConverterMatch, FileConverter, FileConvertInput } from "../contract/extensions.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { ClassificationInfo, FileInfo, ReadMedia, ReadReport } from "../contract/result.ts";
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
  readonly deps: ReadDependencies<THost>;
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

export async function convertFile<THost>(input: ConvertFileInput<THost>): Promise<ReadReport> {
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

  const throwIfSourceFailed = (): void => {
    scope.checkAbort();
    if (source.exceeded) {
      throw new ReadStop(
        tooLarge(messages, request, file, classification, "convert", limits.maxConvertBytes),
      );
    }
    if (source.backendFailure !== null) throw source.backendFailure;
  };
  const failed = (error?: unknown): ReadStop => {
    throwIfSourceFailed();
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
  throwIfSourceFailed();
  const outcome = checkConvertOutcome(produced);
  if (outcome === null) throw failed();
  if (outcome.kind === "refuse") {
    return refusedOutcome(request, file, classification, outcome.code, outcome.note);
  }

  if (outcome.kind === "media") {
    if (mediaBytes(outcome.parts) > limits.maxMediaBytes) {
      return tooLarge(messages, request, file, classification, "media", limits.maxMediaBytes);
    }
    await drainAndVerify(source, handle, input, throwIfSourceFailed);
    return mediaOutcome(input, classification, outcome.parts, outcome.notes ?? [], source);
  }

  let scan;
  try {
    scan = await scanConvertedText(outcome.text, request, file, scope);
  } catch (error) {
    if (error instanceof ReadStop || error instanceof AbortReadError) throw error;
    throw failed(error);
  }
  await drainAndVerify(source, handle, input, throwIfSourceFailed);
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

async function drainAndVerify<THost>(
  source: ConvertSource<THost>,
  handle: OpenFile,
  input: ConvertFileInput<THost>,
  throwIfSourceFailed: () => void,
): Promise<void> {
  const { deps, request, file, scope } = input;
  try {
    await source.drain();
  } catch (error) {
    throwIfSourceFailed();
    throw error;
  }
  scope.enter("verification");
  checkSize(deps.messages, request, file, source.bytesRead);
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
    tool: "read",
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
      // Media is not source text, so it cannot back a text edit.
      wholeFileVisible: false,
    }),
    notes: [...notes, ...capabilityNotes(fs, deps.messages)],
  };
}
