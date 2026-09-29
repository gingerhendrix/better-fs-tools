import type { JsonObject } from "./json.ts";
import type { Confidence, ReadNote } from "./result.ts";

export interface Classifier {
  readonly id: string;
  classify(sample: ClassificationSample): Classification | null;
  /** Refusal for invalid UTF-8 found after the sample was accepted as text. */
  encodingFailure?(sample: ClassificationSample): UnsupportedClassification | null;
}

export interface ClassificationSample {
  /** At most limits.sampleBytes. */
  readonly bytes: Uint8Array;
  /** True when the sample is the whole file. */
  readonly complete: boolean;
  /** Display path, for extension hints. */
  readonly path: string;
  /** MIME type reported by the backend, if any. */
  readonly mimeType: string | null;
}

export type Classification = TextClassification | UnsupportedClassification;

export interface TextClassification {
  readonly kind: "text";
  readonly mimeType: string | null;
  readonly confidence: Confidence;
  readonly reasons: readonly string[];
  readonly notes?: readonly ReadNote[];
}

export interface UnsupportedClassification {
  readonly kind: "unsupported";
  readonly code: string;
  readonly mimeType: string | null;
  readonly confidence: Confidence;
  readonly reasons: readonly string[];
  /** The refusal the model sees. */
  readonly note: ReadNote;
}

export interface NoteOverride {
  readonly code?: string;
  readonly severity?: "info" | "warning";
  readonly message?: string | ((context: NoteContext) => string);
  readonly data?: JsonObject;
}

export interface NoteContext {
  readonly path: string;
  readonly mimeType: string | null;
  readonly reasons: readonly string[];
}

export type BuiltInUnsupportedCode =
  | "BINARY"
  | "IMAGE"
  | "PDF"
  | "NOTEBOOK"
  | "OFFICE_DOCUMENT"
  | "UNKNOWN_ENCODING";

export interface DefaultClassifierOptions {
  readonly notes?: Partial<Record<BuiltInUnsupportedCode, NoteOverride>>;
}
