import type { ConvertOutcome } from "../contract/extensions.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { MessageCatalog } from "../contract/messages.ts";
import type {
  ClassificationInfo,
  ContentPart,
  FileInfo,
  ReadNote,
  ReadUnsupported,
} from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import { ByteCursor } from "./cursor.ts";
import { isRecord } from "./input.ts";
import { isNote } from "./outcomes.ts";
import { scanText } from "./scan.ts";
import type { ScanOutcome } from "./scan.ts";

const ENCODER = new TextEncoder();

/** A text chunk that is not a string. Internal: the core maps it to EXTENSION_FAILED. */
export class ConverterOutputError extends Error {}

export type ScannedText = Extract<ScanOutcome, { kind: "scanned" }>;

/** The outcome when it has the ConvertOutcome shape, else null. */
export function checkConvertOutcome(value: unknown): ConvertOutcome | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "text": {
      const { text, mimeType } = value;
      const textOk = typeof text === "string" || isAsyncIterable(text);
      const mimeOk = mimeType === null || typeof mimeType === "string";
      return textOk && mimeOk && notesOk(value.notes) ? (value as ConvertOutcome) : null;
    }
    case "media": {
      const { parts } = value;
      const partsOk = Array.isArray(parts) && parts.every(isContentPart);
      return partsOk && notesOk(value.notes) ? (value as ConvertOutcome) : null;
    }
    case "refuse":
      return typeof value.code === "string" && value.code !== "" && isNote(value.note)
        ? (value as ConvertOutcome)
        : null;
    default:
      return null;
  }
}

/**
 * Converted text goes through the same LineScanner as file text: offset,
 * limit, clamping, view bytes, and the scan cap all apply. The scan checks the
 * signal on each chunk. contentId comes from the source, so the scan has no digest.
 */
export async function scanConvertedText<THost>(
  text: string | AsyncIterable<string>,
  request: ReadRequest,
  file: FileInfo,
  scope: CallScope<THost>,
): Promise<ScannedText> {
  const cursor = new ByteCursor(encoded(text));
  try {
    const scan = await scanText({
      cursor,
      sample: { bytes: new Uint8Array(0), complete: false, path: file.displayPath, mimeType: null },
      request,
      limits: scope.deps.limits,
      digest: null,
      scope,
    });
    // Encoded JS strings are valid UTF-8.
    if (scan.kind !== "scanned") throw new ConverterOutputError("converted text is not UTF-8");
    return scan;
  } finally {
    await cursor.close();
  }
}

/** Total bytes of the media parts. Text parts do not count. */
export function mediaBytes(parts: readonly ContentPart[]): number {
  let total = 0;
  for (const part of parts) if (part.type === "media") total += part.data.byteLength;
  return total;
}

/** The mediaType of the first media part, or null. */
export function firstMediaType(parts: readonly ContentPart[]): string | null {
  for (const part of parts) if (part.type === "media") return part.mediaType;
  return null;
}

export function refusedOutcome(
  request: ReadRequest,
  file: FileInfo,
  classification: ClassificationInfo,
  code: string,
  note: ReadNote,
): ReadUnsupported {
  return { status: "unsupported", code, request, file, classification, notes: [note] };
}

/** Converter input past maxConvertBytes, or media past maxMediaBytes. */
export function tooLarge(
  messages: Readonly<MessageCatalog>,
  request: ReadRequest,
  file: FileInfo,
  classification: ClassificationInfo,
  stage: "convert" | "media",
  limit: number,
): ReadUnsupported {
  return refusedOutcome(request, file, classification, "TOO_LARGE", {
    code: "too-large",
    severity: "warning",
    message: messages.tooLarge({ request, stage, limit }),
    data: { stage, limit },
  });
}

async function* encoded(text: string | AsyncIterable<string>): AsyncGenerator<Uint8Array> {
  if (typeof text === "string") {
    yield ENCODER.encode(text);
    return;
  }
  for await (const chunk of text) {
    if (typeof chunk !== "string") throw new ConverterOutputError("text chunks must be strings");
    yield ENCODER.encode(chunk);
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

function notesOk(notes: unknown): boolean {
  return notes === undefined || (Array.isArray(notes) && notes.every(isNote));
}

function isContentPart(value: unknown): value is ContentPart {
  if (!isRecord(value)) return false;
  if (value.type === "text") return typeof value.text === "string";
  return (
    value.type === "media" &&
    typeof value.mediaType === "string" &&
    value.data instanceof Uint8Array &&
    (value.name === undefined || typeof value.name === "string")
  );
}
