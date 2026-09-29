import type { FileSystem } from "@better-fs-tools/fs";

import type { ReadInput, ReadRequest } from "../contract/input.ts";
import type { ReadLimits } from "../contract/limits.ts";
import type { ReadMessageCatalog } from "../contract/messages.ts";
import type { ReadNote } from "../contract/result.ts";
import type { LineScanner } from "./scanner.ts";

const MAX_LISTED_CLAMPED_LINES = 20;

export interface ViewNoteContext {
  readonly scanner: LineScanner;
  readonly request: ReadRequest;
  readonly limits: Readonly<ReadLimits>;
  readonly messages: Readonly<ReadMessageCatalog>;
  readonly scanCapped: boolean;
}

export function buildViewNotes(context: ViewNoteContext): ReadNote[] {
  const { scanner, request, limits, messages, scanCapped } = context;
  const notes: ReadNote[] = [];

  const offsetUnreached =
    scanCapped &&
    scanner.lines.length === 0 &&
    scanner.firstUnshown === null &&
    request.offset > scanner.totalLines + 1;

  if (offsetUnreached) {
    const reachedLine = scanner.totalLines + 1;
    const retry = retryFrom(request, reachedLine);
    notes.push({
      code: "offset-unreached",
      severity: "warning",
      message: messages.offsetUnreached({ request, reachedLine, retry: messages.retry(retry) }),
      retry,
      data: { reachedLine },
    });
  } else if (
    scanner.selectionStop === "bytes" &&
    scanner.lines.length === 0 &&
    scanner.firstUnshown !== null
  ) {
    const line = scanner.firstUnshown;
    const retry = retryFrom(request, line + 1);
    notes.push({
      code: "first-line-exceeds-byte-limit",
      severity: "warning",
      message: messages.firstLineTooLong({
        line,
        maxViewBytes: limits.maxViewBytes,
        retry: messages.retry(retry),
      }),
      retry,
      data: { line },
    });
  } else if (scanner.firstUnshown !== null) {
    const retry = retryFrom(request, scanner.firstUnshown);
    const reason = scanner.selectionStop ?? "scan-limit";
    notes.push({
      code: "continue",
      severity: "info",
      message: messages.continuation({ request, retry: messages.retry(retry), reason }),
      retry,
      data: { reason },
    });
  }

  const clamped = scanner.clampedLines;
  if (clamped.length > 0) {
    const listed = clamped.slice(0, MAX_LISTED_CLAMPED_LINES);
    notes.push({
      code: "line-clamped",
      severity: "warning",
      message: messages.lineClamped({
        lines: listed,
        total: clamped.length,
        maxChars: limits.maxCharsPerLine,
      }),
      data: { lines: [...listed], total: clamped.length, maxChars: limits.maxCharsPerLine },
    });
  }

  if (scanCapped) {
    notes.push({
      code: "scan-limit",
      severity: "warning",
      message: messages.scanLimit({ maxScanBytes: limits.maxScanBytes }),
      data: { maxScanBytes: limits.maxScanBytes },
    });
  }

  if (
    !scanCapped &&
    scanner.lines.length === 0 &&
    request.offset > scanner.totalLines &&
    scanner.totalLines > 0
  ) {
    const retry = retryFrom(request, Math.max(1, scanner.totalLines));
    notes.push({
      code: "offset-past-eof",
      severity: "info",
      message: messages.offsetPastEof({
        request,
        totalLines: scanner.totalLines,
        retry: messages.retry(retry),
      }),
      retry,
      data: { totalLines: scanner.totalLines },
    });
  }

  return notes;
}

export function emptyNote(messages: Readonly<ReadMessageCatalog>, path: string): ReadNote {
  return { code: "empty", severity: "info", message: messages.empty({ path }) };
}

export function capabilityNotes(
  fs: FileSystem,
  messages: Readonly<ReadMessageCatalog>,
): ReadNote[] {
  const notes: ReadNote[] = [];
  if (!fs.capabilities.identity) {
    notes.push({
      code: "weak-identity",
      severity: "info",
      message: messages.weakIdentity({ backend: fs.id }),
      data: { backend: fs.id },
    });
  }
  if (!fs.capabilities.streaming) {
    notes.push({
      code: "buffered-backend",
      severity: "info",
      message: messages.bufferedBackend({ backend: fs.id }),
      data: { backend: fs.id },
    });
  }
  return notes;
}

function retryFrom(request: ReadRequest, offset: number): ReadInput {
  return { path: request.path, offset, limit: request.limit };
}
