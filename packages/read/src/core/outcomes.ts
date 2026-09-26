import type { FileSystemError } from "@better-fs-tools/fs";

import type { UnsupportedClassification } from "../contract/classify.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { JsonValue } from "../contract/json.ts";
import type { MessageCatalog, ReadPhase } from "../contract/messages.ts";
import type {
  FileInfo,
  ReadErrorCode,
  ReadFailure,
  ReadNote,
  ReadOutcome,
  ReadUnsupported,
} from "../contract/result.ts";
import { isRecord } from "./input.ts";

type Messages = Readonly<MessageCatalog>;

/** Thrown by a stage to end the read with a finished outcome. Internal. */
export class ReadStop extends Error {
  constructor(readonly outcome: ReadOutcome) {
    super(`read stopped with ${outcome.status}`);
  }
}

export function failure(
  code: ReadErrorCode,
  request: ReadRequest | null,
  file: FileInfo | null,
  note: ReadNote,
): ReadFailure {
  return { status: "error", code, request, file, notes: [note] };
}

export function invalidInput(messages: Messages, input: unknown, error: unknown): ReadFailure {
  const path = isRecord(input) && typeof input.path === "string" ? input.path : "";
  return failure("INVALID_INPUT", null, null, {
    code: "invalid-input",
    severity: "warning",
    message: messages.invalidInput({ detail: messageOf(error) }),
    ...(path === "" ? {} : { data: { path } }),
  });
}

export function aborted(messages: Messages, request: ReadRequest, phase: ReadPhase): ReadFailure {
  return failure("ABORTED", request, null, {
    code: "aborted",
    severity: "warning",
    message: messages.aborted({ phase }),
    data: { phase },
  });
}

/** `extension` is the dependency name. `id` is the extension object's id, when it has one. */
export function extensionFailed(
  messages: Messages,
  request: ReadRequest,
  extension: string,
  phase: ReadPhase,
  id: string | null = null,
): ReadFailure {
  return failure("EXTENSION_FAILED", request, null, {
    code: "extension-failed",
    severity: "warning",
    message: messages.extensionFailed({ request, extension, phase }),
    data: id === null ? { extension, phase } : { extension, phase, id },
  });
}

/**
 * DENIED from the authorizer. The authorizer's note when it gave one, else the
 * default. No file info: a denial does not disclose the open target.
 */
export function denied(
  messages: Messages,
  request: ReadRequest,
  note: ReadNote | null,
): ReadFailure {
  return failure(
    "DENIED",
    request,
    null,
    note ?? {
      code: "denied",
      severity: "warning",
      message: messages.denied({ request, detail: null }),
    },
  );
}

export function ioError(messages: Messages, request: ReadRequest, error: unknown): ReadFailure {
  return failure("IO_ERROR", request, null, {
    code: "io-error",
    severity: "warning",
    message: messages.ioError({ request }),
    data: { detail: messageOf(error) },
  });
}

export function changedDuringRead(
  messages: Messages,
  request: ReadRequest,
  file: FileInfo,
): ReadFailure {
  const retry = { path: request.path, offset: request.offset, limit: request.limit };
  return failure("CHANGED_DURING_READ", request, file, {
    code: "changed-during-read",
    severity: "warning",
    message: messages.changedDuringRead({ request, retry: messages.retry(retry) }),
    retry,
  });
}

export function unsupportedBackend(
  messages: Messages,
  request: ReadRequest,
  file: FileInfo,
  detail: string | null,
): ReadFailure {
  return failure("UNSUPPORTED_BACKEND", request, file, {
    code: "unsupported-backend",
    severity: "warning",
    message: messages.unsupportedBackend({ request, detail }),
  });
}

export function unsupportedOutcome(
  request: ReadRequest,
  file: FileInfo,
  classifier: string,
  classification: UnsupportedClassification,
): ReadUnsupported {
  return {
    status: "unsupported",
    code: classification.code,
    request,
    file,
    classification: {
      kind: "unsupported",
      classifier,
      code: classification.code,
      mimeType: classification.mimeType,
      confidence: classification.confidence,
      reasons: classification.reasons,
    },
    notes: [classification.note],
  };
}

const CODE_BY_REASON = {
  "not-found": "NOT_FOUND",
  "not-a-file": "NOT_A_FILE",
  "dangerous-path": "DANGEROUS_PATH",
  "outside-allowed-roots": "OUTSIDE_ALLOWED_ROOTS",
  "permission-denied": "PERMISSION_DENIED",
  denied: "DENIED",
  unsupported: "UNSUPPORTED_BACKEND",
  aborted: "ABORTED",
  io: "IO_ERROR",
} as const satisfies Record<FileSystemError["reason"], ReadErrorCode>;

/** Maps a typed filesystem refusal to a failure. `phase` names the stage for an abort. */
export function fromFileSystemError(
  messages: Messages,
  request: ReadRequest,
  error: FileSystemError,
  phase: ReadPhase,
  file: FileInfo | null = null,
): ReadFailure {
  const code = CODE_BY_REASON[error.reason];
  if (code === "ABORTED") return aborted(messages, request, phase);
  const detail = error.detail ?? null;
  const data = errorData(error);
  return failure(code, request, file, {
    code: code.toLowerCase().replaceAll("_", "-"),
    severity: "warning",
    message: messageForError(messages, request, error, detail),
    ...(Object.keys(data).length === 0 ? {} : { data }),
  });
}

/** Note data for a filesystem refusal: kind, detail, and cause when the adapter gave them. */
export function errorData(error: FileSystemError): Record<string, JsonValue> {
  return {
    ...(error.reason === "not-a-file" ? { kind: error.kind } : {}),
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    ...(error.cause === undefined ? {} : { cause: { ...error.cause } }),
  };
}

/** NOT_FOUND. `data` holds the adapter's detail and the suggestion fields, when any. */
export function notFound(
  messages: Messages,
  request: ReadRequest,
  suggestions: readonly string[],
  data: Record<string, JsonValue>,
): ReadFailure {
  return failure("NOT_FOUND", request, null, {
    code: "not-found",
    severity: "warning",
    message: messages.notFound({ request, suggestions }),
    ...(Object.keys(data).length === 0 ? {} : { data }),
  });
}

function messageForError(
  messages: Messages,
  request: ReadRequest,
  error: FileSystemError,
  detail: string | null,
): string {
  switch (error.reason) {
    case "not-found":
      return messages.notFound({ request, suggestions: [] });
    case "not-a-file":
      return messages.notAFile({ request, kind: error.kind });
    case "dangerous-path":
      return messages.dangerousPath({ request, detail });
    case "outside-allowed-roots":
      return messages.outsideAllowedRoots({ request, detail });
    case "permission-denied":
      return messages.permissionDenied({ request, detail });
    case "denied":
      return messages.denied({ request, detail });
    case "unsupported":
      return messages.unsupportedBackend({ request, detail });
    default:
      return messages.ioError({ request });
  }
}

export function isNote(value: unknown): value is ReadNote {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    (value.severity === "info" || value.severity === "warning")
  );
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
