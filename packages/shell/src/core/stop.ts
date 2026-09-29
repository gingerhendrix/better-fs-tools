import type { JsonObject, Note } from "@better-fs-tools/read";

import type { ShellErrorCode, ShellPhase } from "../contract/result.ts";

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

export function noteCode(code: ShellErrorCode): string {
  return code.toLowerCase().replaceAll("_", "-");
}

export function errorNote(code: ShellErrorCode, message: string, data?: JsonObject): Note {
  return warning(noteCode(code), message, data);
}

export function hostErrorNote(code: ShellErrorCode, note: Note): Note {
  const kebab = noteCode(code);
  return errorNote(
    code,
    note.message,
    note.code === kebab ? note.data : { ...note.data, source: note.code },
  );
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
