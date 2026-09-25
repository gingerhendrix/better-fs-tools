import type { FileSystem } from "@better-fs-tools/fs";

import type { TextClassification } from "../contract/classify.ts";
import type { Dependencies } from "../contract/deps.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { FileInfo, ReadOk, TruncationReason } from "../contract/result.ts";
import type { Decision } from "./classify.ts";
import { buildViewNotes, capabilityNotes, emptyNote } from "./notes.ts";
import { buildObservation } from "./observation.ts";
import type { ScanOutcome } from "./scan.ts";

export interface TextOutcomeInput<THost> {
  readonly deps: Dependencies<THost>;
  readonly fs: FileSystem;
  readonly request: ReadRequest;
  readonly file: FileInfo;
  readonly decision: Decision<TextClassification>;
  readonly scan: Extract<ScanOutcome, { kind: "scanned" }>;
}

/** Builds the ok outcome from a finished, verified scan. */
export function textOutcome<THost>(input: TextOutcomeInput<THost>): ReadOk {
  const { deps, fs, request, file, decision, scan } = input;
  const { scanner, scanCapped, reachedEof, scannedBytes } = scan;
  const { classification } = decision;

  const reasons: TruncationReason[] = [];
  if (scanner.selectionStop === "lines") reasons.push("lines");
  if (scanner.selectionStop === "bytes") reasons.push("bytes");
  if (scanCapped) reasons.push("scan-limit");
  if (scanner.clampedLines.length > 0) reasons.push("line-length");

  const continuationAvailable = scanner.firstUnshown !== null;
  const wholeFileVisible =
    request.offset === 1 &&
    !continuationAvailable &&
    !scanCapped &&
    scanner.clampedLines.length === 0;

  return {
    status: "ok",
    request,
    file,
    classification: {
      kind: "text",
      classifier: decision.classifier,
      code: null,
      mimeType: classification.mimeType,
      confidence: classification.confidence,
      reasons: classification.reasons,
    },
    conversion: null,
    view: {
      lines: scanner.lines,
      startLine: request.offset,
      endLine:
        scanner.lines.length === 0 ? request.offset - 1 : request.offset + scanner.lines.length - 1,
      bytes: scanner.viewBytes,
      partial: request.offset !== 1 || continuationAvailable || reasons.length > 0,
    },
    truncation: { truncated: reasons.length > 0, reasons, primary: reasons[0] ?? null },
    continuation: {
      available: continuationAvailable,
      next:
        scanner.firstUnshown === null
          ? null
          : { path: request.path, offset: scanner.firstUnshown, limit: request.limit },
    },
    totals: {
      lines: scanCapped ? null : scanner.totalLines,
      exact: !scanCapped,
      bytes: reachedEof ? scannedBytes : (file.size ?? scannedBytes),
    },
    observation: buildObservation(deps.digest, {
      file,
      contentId: scan.contentId,
      viewText: scanner.viewText,
      observedAt: deps.clock().toISOString(),
      wholeFileVisible,
    }),
    notes: [
      ...buildViewNotes({
        scanner,
        request,
        limits: deps.limits,
        messages: deps.messages,
        scanCapped,
      }),
      ...(classification.notes ?? []),
      ...(reachedEof && scannedBytes === 0 ? [emptyNote(deps.messages, file.displayPath)] : []),
      ...capabilityNotes(fs, deps.messages),
    ],
  };
}
