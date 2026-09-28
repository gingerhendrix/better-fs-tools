import type { JsonObject, Note } from "@better-fs-tools/read";

import type { ShellErrorCode, ShellPhase } from "../contract/result.ts";

/** Ends the call with status "error". `note` is the error note. */
export class StageStop extends Error {
  constructor(
    readonly code: ShellErrorCode,
    readonly phase: ShellPhase,
    readonly note: Note,
  ) {
    super(code);
  }
}

export function warning(code: string, message: string, data?: JsonObject): Note {
  return data === undefined
    ? { code, severity: "warning", message }
    : { code, severity: "warning", message, data };
}

export function info(code: string, message: string, data?: JsonObject): Note {
  return data === undefined
    ? { code, severity: "info", message }
    : { code, severity: "info", message, data };
}

/** "OUTPUT_CAP" gives "output-cap". Every error note uses its code this way. */
export function noteCode(code: ShellErrorCode): string {
  return code.toLowerCase().replaceAll("_", "-");
}

/** The warning note of an error, with the error code in kebab case. */
export function errorNote(code: ShellErrorCode, message: string, data?: JsonObject): Note {
  return warning(noteCode(code), message, data);
}

export function isNote(value: unknown): value is Note {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.code === "string" &&
    typeof note.message === "string" &&
    (note.severity === "info" || note.severity === "warning")
  );
}

export function isNoteList(value: unknown): value is readonly Note[] {
  return Array.isArray(value) && value.every(isNote);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function extensionId(extension: unknown): string {
  if (extension === null || typeof extension !== "object" || !("id" in extension)) return "unknown";
  return typeof extension.id === "string" ? extension.id : "unknown";
}
