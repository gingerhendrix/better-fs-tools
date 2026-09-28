import type { JsonObject, Note } from "@better-fs-tools/read";

import type { ShellErrorCode, ShellPhase } from "../contract/result.ts";

/** Ends the call before the command starts: "refused" or "error". */
export class StageStop extends Error {
  constructor(
    readonly status: "refused" | "error",
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

export function info(code: string, message: string): Note {
  return { code, severity: "info", message };
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
