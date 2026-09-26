import type { FileSystem } from "@better-fs-tools/fs";

import type { Dependencies } from "../contract/deps.ts";
import type { ReadRequest } from "../contract/input.ts";
import type {
  ClassificationInfo,
  ConversionInfo,
  FileInfo,
  ReadNote,
  ReadOk,
  TruncationReason,
} from "../contract/result.ts";
import { buildViewNotes, capabilityNotes, emptyNote } from "./notes.ts";
import { buildObservation } from "./observation.ts";
import type { ScanOutcome } from "./scan.ts";

export interface TextOutcomeInput<THost> {
  readonly deps: Dependencies<THost>;
  /** The backend, for capability notes. null for a directory: it has no observation. */
  readonly fs: FileSystem | null;
  readonly request: ReadRequest;
  readonly file: FileInfo;
  readonly classification: ClassificationInfo;
  /** Set when a converter produced the text. */
  readonly conversion: ConversionInfo | null;
  readonly scan: Extract<ScanOutcome, { kind: "scanned" }>;
  /** Hash of the source bytes. For converted text this is the source, not the text. */
  readonly contentId: string | null;
  /** From the classifier or the converter. They follow the view notes. */
  readonly notes: readonly ReadNote[];
}

/**
 * Builds the ok outcome from a finished, verified scan of file text or
 * converted text. A directory (fs null) gets no observation.
 */
export function textOutcome<THost>(input: TextOutcomeInput<THost>): ReadOk {
  const { deps, fs, request, file, classification, conversion, scan } = input;
  const { scanner, scanCapped, reachedEof, scannedBytes } = scan;

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
    classification,
    conversion,
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
      // Converted text has no size of its own: the count is the text scanned.
      bytes: reachedEof || conversion !== null ? scannedBytes : (file.size ?? scannedBytes),
    },
    observation:
      fs === null
        ? null
        : buildObservation(deps.digest, {
            file,
            contentId: input.contentId,
            view: scanner.viewText,
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
      ...input.notes,
      ...(conversion === null && reachedEof && scannedBytes === 0
        ? [emptyNote(deps.messages, file.displayPath)]
        : []),
      ...(fs === null ? [] : capabilityNotes(fs, deps.messages)),
    ],
  };
}
