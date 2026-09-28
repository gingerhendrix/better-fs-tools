import type { Note, ToolError } from "./base.ts";
import type { ReadInput, ReadRequest } from "./input.ts";
import type { ReadPhase } from "./messages.ts";

export interface TextPart {
  readonly type: "text";
  readonly text: string;
}

export interface MediaPart {
  readonly type: "media";
  readonly mediaType: string;
  readonly data: Uint8Array;
  readonly name?: string;
}

export type ContentPart = TextPart | MediaPart;

/**
 * One variant for each status. `status` narrows the union: only the "error"
 * variant has `error`, and it is never null there.
 */
export type ReadReport = ReadOk | ReadMedia | ReadUnsupported | ReadFailure;

/** The outcome plus the formatter's model-facing content. */
export type ReadResult = ReadReport & { readonly content: readonly ContentPart[] };

export interface ReadOk {
  readonly tool: "read";
  readonly status: "ok";
  readonly request: ReadRequest;
  readonly file: FileInfo;
  readonly classification: ClassificationInfo;
  /** Set when a converter produced the text. */
  readonly conversion: ConversionInfo | null;
  readonly view: ReadView;
  readonly truncation: ReadTruncation;
  readonly continuation: ReadContinuation;
  readonly totals: ReadTotals;
  readonly observation: ReadObservation | null;
  readonly notes: readonly ReadNote[];
}

export interface ReadMedia {
  readonly tool: "read";
  readonly status: "media";
  readonly request: ReadRequest;
  readonly file: FileInfo;
  readonly classification: ClassificationInfo;
  readonly conversion: ConversionInfo;
  readonly parts: readonly ContentPart[];
  readonly observation: ReadObservation | null;
  readonly notes: readonly ReadNote[];
}

export interface ReadUnsupported {
  readonly tool: "read";
  readonly status: "unsupported";
  /** Open vocabulary: classifier codes, converter refusal codes, "TOO_LARGE". */
  readonly code: string;
  readonly request: ReadRequest;
  readonly file: FileInfo;
  readonly classification: ClassificationInfo;
  readonly notes: readonly ReadNote[];
}

export interface ReadFailure {
  readonly tool: "read";
  readonly status: "error";
  readonly error: ReadError;
  readonly request: ReadRequest | null;
  readonly file: FileInfo | null;
  readonly notes: readonly ReadNote[];
}

/** The error of a failed read. Same shape as the write and shell errors. */
export type ReadError = ToolError<ReadErrorCode, ReadPhase>;

/** UPPER_SNAKE, like every tool's error codes. The error note's code is the kebab-case form. */
export type ReadErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_A_FILE"
  | "DANGEROUS_PATH"
  | "OUTSIDE_ALLOWED_ROOTS"
  | "PERMISSION_DENIED"
  | "DENIED"
  | "TOO_LARGE"
  | "CHANGED_DURING_READ"
  | "ABORTED"
  | "UNSUPPORTED_BACKEND"
  | "EXTENSION_FAILED"
  | "IO_ERROR";

export interface FileInfo {
  /** The path in the model's input, before any resolver. */
  readonly requestedPath: string;
  readonly resolvedPath: string;
  readonly displayPath: string;
  /** `fs.id` of the backend that served the read. */
  readonly backend: string;
  readonly size: number | null;
  readonly mtimeMs: number | null;
  /** `null` unless `fs.capabilities.identity`. */
  readonly identity: string | null;
  readonly mimeType: string | null;
  /** The requested path when a resolver changed it, else null. */
  readonly resolvedFrom: string | null;
  /** `info.version` from the backend, or null. Kept when `capabilities.identity` is false. */
  readonly version: string | null;
}

export interface ClassificationInfo {
  readonly kind: "text" | "unsupported" | "directory";
  /** Classifier id, or "fs" for a directory. */
  readonly classifier: string;
  /** Unsupported code from the classifier. null for text and directories. */
  readonly code: string | null;
  readonly mimeType: string | null;
  readonly confidence: Confidence;
  readonly reasons: readonly string[];
}

export interface ConversionInfo {
  readonly converter: string;
  /** Media type of the converted output. */
  readonly mimeType: string | null;
}

export type Confidence = "high" | "medium" | "low";

export interface ReadView {
  readonly lines: readonly ReadLine[];
  readonly startLine: number;
  /** startLine - 1 when the view is empty. */
  readonly endLine: number;
  /** UTF-8 bytes of source text in the view, before any gutter. */
  readonly bytes: number;
  readonly partial: boolean;
}

export interface ReadLine {
  readonly number: number;
  /** Source text, clamped to limits.maxCharsPerLine. No gutter, no marker. */
  readonly text: string;
  readonly clamped: boolean;
  /** Length of the source line in characters when clamped, else null. */
  readonly sourceChars: number | null;
}

export type TruncationReason = "lines" | "bytes" | "budget" | "line-length" | "scan-limit";

export interface ReadTruncation {
  readonly truncated: boolean;
  readonly reasons: readonly TruncationReason[];
  readonly primary: TruncationReason | null;
}

export interface ReadContinuation {
  readonly available: boolean;
  /** The exact next canonical call. */
  readonly next: ReadInput | null;
}

export interface ReadTotals {
  /** null when the scan limit stopped counting. */
  readonly lines: number | null;
  readonly exact: boolean;
  readonly bytes: number;
}

export interface ReadNote extends Note {
  /** A concrete canonical retry. */
  readonly retry?: ReadInput;
}

export interface ReadObservation {
  readonly id: string;
  readonly statId: string;
  /** Hash of the source bytes. null when the scan stopped before EOF. */
  readonly contentId: string | null;
  /** Hash of what the model saw. Recomputed after a hook edits the view. */
  readonly viewId: string;
  readonly observedAt: string;
  /** True when offset is 1, nothing was truncated or clamped, and no hook edited the view. */
  readonly wholeFileVisible: boolean;
}
