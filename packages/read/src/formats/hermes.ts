import type { ReadFormatter } from "../contract/format.ts";
import type { JsonObject } from "../contract/json.ts";
import type { ReadNote, ReadReport } from "../contract/result.ts";
import { jsonFormatter } from "../formatters/json.ts";
import { isDirectory } from "./shared.ts";

/**
 * Hermes style: one JSON object. Text gives `content` with `12|text` lines,
 * `total_lines`, `file_size`, `truncated` (any cut, a clamped line too),
 * `next_offset` (when more lines follow), and the notes joined as `hint`.
 * Failures and refusals give `error`, and a miss adds `similar_files`. Media
 * gives the JSON, then the media parts. "view" mode leaves out the hint.
 */
export function hermesFormat(): ReadFormatter<unknown> {
  const json = jsonFormatter({ pick: hermesFields });
  return Object.freeze<ReadFormatter<unknown>>({
    id: "hermes",
    format: (outcome, ctx) =>
      json.format(ctx.mode === "view" ? withoutNotes(outcome) : outcome, ctx),
  });
}

function withoutNotes(outcome: ReadReport): ReadReport {
  return { ...outcome, notes: [] };
}

function hermesFields(outcome: ReadReport): JsonObject {
  const messages = outcome.notes.map((note) => note.message).join(" ");
  const hint: JsonObject = messages === "" ? {} : { hint: messages };
  const size = outcome.file?.size ?? null;
  const fileSize: JsonObject = size === null ? {} : { file_size: size };
  switch (outcome.status) {
    case "ok": {
      const directory = isDirectory(outcome);
      const content = outcome.view.lines
        .map((line) =>
          directory
            ? line.text
            : `${line.number}|${line.text}${line.clamped ? "... [truncated]" : ""}`,
        )
        .join("\n");
      const total = outcome.totals.lines;
      const offset = outcome.continuation.next?.offset;
      return {
        content,
        ...(total === null ? {} : { [directory ? "total_entries" : "total_lines"]: total }),
        ...fileSize,
        truncated: outcome.truncation.truncated,
        ...(offset === undefined ? {} : { next_offset: offset }),
        ...hint,
      };
    }
    case "media": {
      const text = outcome.parts.flatMap((part) => (part.type === "text" ? [part.text] : []));
      return {
        ...(text.length === 0 ? {} : { content: text.join("\n") }),
        mime_type: outcome.conversion.mimeType,
        ...fileSize,
        ...hint,
      };
    }
    case "unsupported":
      return { error: messages || outcome.code, ...fileSize };
    case "error":
      return { error: messages || outcome.error.code, ...similarFiles(outcome.notes) };
  }
}

function similarFiles(notes: readonly ReadNote[]): JsonObject {
  const suggestions = notes.find((note) => note.code === "not-found")?.data?.["suggestions"];
  return Array.isArray(suggestions) && suggestions.length > 0 ? { similar_files: suggestions } : {};
}
