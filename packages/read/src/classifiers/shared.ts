import type {
  BuiltInUnsupportedCode,
  Classification,
  ClassificationSample,
  Classifier,
  NoteContext,
  NoteOverride,
  UnsupportedClassification,
} from "../contract/classify.ts";
import type { Confidence, ReadNote } from "../contract/result.ts";

export function classifier(
  id: string,
  classify: (sample: ClassificationSample) => Classification | null,
): Classifier {
  return Object.freeze({ id, classify });
}

export function unsupported(
  code: BuiltInUnsupportedCode,
  mimeType: string | null,
  reasons: readonly string[],
  sample: ClassificationSample,
  override: NoteOverride | undefined,
  suggestedTool: string,
): UnsupportedClassification {
  return refusal({
    code,
    mimeType,
    confidence: "high",
    reasons,
    sample,
    override,
    message: `This content is not supported as UTF-8 text. Use ${suggestedTool}.`,
  });
}

export function refusal(options: {
  code: string;
  mimeType: string | null;
  confidence: Confidence;
  reasons: readonly string[];
  sample: ClassificationSample;
  override: NoteOverride | undefined;
  message: string;
}): UnsupportedClassification {
  const { code, mimeType, confidence, reasons, sample, override } = options;
  const base: ReadNote = {
    code: `unsupported-${code.toLowerCase().replaceAll("_", "-")}`,
    severity: "warning",
    message: options.message,
  };
  return {
    kind: "unsupported",
    code: override?.code ?? code,
    mimeType,
    confidence,
    reasons,
    note: applyOverride(base, override, { path: sample.path, mimeType, reasons }),
  };
}

function applyOverride(
  note: ReadNote,
  override: NoteOverride | undefined,
  context: NoteContext,
): ReadNote {
  if (override === undefined) return note;
  const message =
    typeof override.message === "function" ? override.message(context) : override.message;
  return {
    code: override.code ?? note.code,
    severity: override.severity ?? note.severity,
    message: message ?? note.message,
    ...(override.data === undefined ? {} : { data: override.data }),
  };
}

export function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

export function startsWithAscii(bytes: Uint8Array, prefix: string): boolean {
  return startsWith(
    bytes,
    [...prefix].map((character) => character.charCodeAt(0)),
  );
}

export function asciiProjection(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : " ";
  }
  return result;
}

export function isZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
}
