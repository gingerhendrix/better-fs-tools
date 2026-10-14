import { Type } from "typebox";
import type { Static } from "typebox";

import type { ShellResult } from "@better-fs-tools/shell";

import type { PiContentPart } from "./parts.ts";

/** Pi's ToolAnnotations: MCP tool hints that permission extensions read. */
export interface PiToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** read changes nothing. */
export const PI_READ_ANNOTATIONS: Readonly<PiToolAnnotations> = Object.freeze({
  readOnlyHint: true,
});

/** edit and apply_patch can replace or remove file content, and a second run is not a no-op. */
export const PI_PATCH_ANNOTATIONS: Readonly<PiToolAnnotations> = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
});

/** write replaces a whole file. The same call twice gives the same file. */
export const PI_WRITE_ANNOTATIONS: Readonly<PiToolAnnotations> = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
});

/** The output schema of Pi's own read: the text, or the first image with the text as a note. */
export const PI_READ_OUTPUT_SCHEMA = Type.Union([
  Type.String(),
  Type.Object({
    type: Type.Literal("image"),
    data: Type.String(),
    mimeType: Type.String(),
    note: Type.String(),
  }),
]);

/** What a codemode script gets from read. */
export type PiReadOutput = Static<typeof PI_READ_OUTPUT_SCHEMA>;

/** The output schema of Pi's own bash, so scripts written for it keep working. */
export const PI_BASH_OUTPUT_SCHEMA = Type.Object({
  output: Type.String({ description: "Combined stdout and stderr, possibly truncated" }),
  truncated: Type.Boolean(),
  full_output_path: Type.Optional(Type.String({ description: "Full output, when truncated" })),
  exit_code: Type.Number(),
  wall_time_seconds: Type.Number(),
});

/** What a codemode script gets from bash. */
export type PiBashOutput = Static<typeof PI_BASH_OUTPUT_SCHEMA>;

/** As Pi's own read: the first text part, or the first image with the text as its note. */
export function toPiReadOutput(content: readonly PiContentPart[]): PiReadOutput {
  let text = "";
  for (const part of content) {
    if (part.type === "text") {
      text = part.text;
      break;
    }
  }
  for (const part of content) {
    if (part.type === "image") {
      return { type: "image", data: part.data, mimeType: part.mimeType, note: text };
    }
  }
  return text;
}

/**
 * Pi's bash structured output for a command that ended by itself, with an exit
 * code. undefined for a timeout, an abort, a signal, or an error: Pi's own bash
 * throws for these, so a codemode script then gets a rejection.
 */
export function toPiBashOutput(result: ShellResult): PiBashOutput | undefined {
  if (result.status !== "ok" && result.status !== "failed") return undefined;
  const { run, output } = result;
  if (run.exitCode === null || run.stoppedBy !== null) return undefined;
  const truncated = output.tail !== null;
  return {
    // The same marker as Pi's own bash output between the head and the tail.
    output:
      output.tail === null
        ? output.head
        : `${output.head}\n\n[... ${output.omittedBytes} bytes omitted ...]\n\n${output.tail}`,
    truncated,
    ...(truncated && output.spill !== null ? { full_output_path: output.spill } : {}),
    exit_code: run.exitCode,
    wall_time_seconds: Math.round(run.durationMs / 100) / 10,
  };
}
