import type { FileSystemError, MutationError } from "@better-fs-tools/fs";
import type { JsonObject, JsonValue, Note } from "@better-fs-tools/read";

import type { WriteToolName } from "../contract/context.ts";
import type { WriteMessageCatalog } from "../contract/messages.ts";
import type { MutationFailure, WriteErrorCode, WritePhase } from "../contract/result.ts";
import { isRecord } from "./input.ts";

type Messages = Readonly<WriteMessageCatalog>;

/** Thrown by a stage to end the call with a finished error report. Internal. */
export class WriteStop extends Error {
  constructor(readonly report: MutationFailure) {
    super(`write stopped with ${report.error.code}`);
  }
}

/** "NOT_READ" gives "not-read". Every error note uses its code this way. */
export function noteCode(code: WriteErrorCode): string {
  return code.toLowerCase().replaceAll("_", "-");
}

/** The one warning note of an error report. */
export function errorNote(code: WriteErrorCode, message: string, data?: JsonObject): Note {
  return {
    code: noteCode(code),
    severity: "warning",
    message,
    ...(data === undefined || Object.keys(data).length === 0 ? {} : { data }),
  };
}

/**
 * An error note built from a host note (a guard or authorizer refusal). The
 * code becomes the error code. The host's own code moves to data.source.
 */
export function hostErrorNote(code: WriteErrorCode, note: Note, data: JsonObject = {}): Note {
  const merged: JsonObject = { ...note.data, ...data };
  return errorNote(
    code,
    note.message,
    note.code === noteCode(code) ? merged : { ...merged, source: note.code },
  );
}

/** An error report with one note. `error.message` and `error.data` come from the note. */
export function failure(tool: WriteToolName, phase: WritePhase, note: Note): MutationFailure {
  const code = codeOfNote(note);
  return {
    tool,
    status: "error",
    error: {
      code,
      phase,
      message: note.message,
      ...(note.data === undefined ? {} : { data: note.data }),
    },
    changes: [],
    unchanged: [],
    notes: [note],
    commit: null,
  };
}

function codeOfNote(note: Note): WriteErrorCode {
  return note.code.toUpperCase().replaceAll("-", "_") as WriteErrorCode;
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
  changed: "STALE",
  exists: "EXISTS",
  "read-only": "READ_ONLY",
  "no-space": "NO_SPACE",
  "too-large": "TOO_LARGE",
} as const satisfies Record<MutationError["reason"], WriteErrorCode>;

/** Section 5.11: the code for a backend refusal. */
export function codeForReason(reason: MutationError["reason"]): WriteErrorCode {
  return CODE_BY_REASON[reason];
}

/** The error note for a typed backend refusal. `path` is the requested path. */
export function backendErrorNote(
  messages: Messages,
  tool: WriteToolName,
  path: string,
  error: FileSystemError | MutationError,
  phase: WritePhase,
): Note {
  const code = codeForReason(error.reason);
  if (code === "ABORTED") return errorNote(code, messages.aborted({ phase }), { phase });
  return errorNote(code, messageForError(messages, tool, path, error, phase), errorData(error));
}

/** Note data for a backend refusal: kind, detail, and cause when the backend gave them. */
function errorData(error: FileSystemError | MutationError): Record<string, JsonValue> {
  return {
    ...(error.reason === "not-a-file" ? { kind: error.kind } : {}),
    ...(error.reason === "too-large" ? { limit: error.limit, size: error.size } : {}),
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    ...(error.cause === undefined ? {} : { cause: { ...error.cause } }),
  };
}

function messageForError(
  messages: Messages,
  tool: WriteToolName,
  path: string,
  error: FileSystemError | MutationError,
  phase: WritePhase,
): string {
  const detail = error.detail ?? null;
  switch (error.reason) {
    case "not-found":
      return messages.notFound({ tool, path });
    case "not-a-file":
      return messages.notAFile({ path, kind: error.kind });
    case "dangerous-path":
      return messages.dangerousPath({ path, detail });
    case "outside-allowed-roots":
      return messages.outsideAllowedRoots({ path });
    case "permission-denied":
      return messages.permissionDenied({ path });
    case "denied":
      return messages.denied({ path, detail });
    case "unsupported":
      return messages.unsupportedBackend({ path, detail });
    case "changed":
      return messages.stale({ tool, path });
    case "exists":
      return messages.exists({ tool, path });
    case "read-only":
      return messages.readOnly({ path });
    case "no-space":
      return messages.noSpace({ path });
    case "too-large":
      // A ceiling on the way in is about the file; on the way out, about the new content.
      return messages.tooLarge({
        path,
        what: phase === "commit" ? "content" : "file",
        limit: error.limit,
        existing: false,
      });
    default:
      return messages.ioError({ path });
  }
}

/** A typed refusal from a backend: an object with a known reason. */
export function isBackendError(value: unknown): value is MutationError {
  return isRecord(value) && typeof value.reason === "string" && value.reason in CODE_BY_REASON;
}

export function isNote(value: unknown): value is Note {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    (value.severity === "info" || value.severity === "warning")
  );
}

export function isNoteList(value: unknown): value is readonly Note[] {
  return Array.isArray(value) && value.every(isNote);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
