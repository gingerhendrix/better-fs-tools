import type { Formatter } from "../contract/format.ts";
import type { JsonObject } from "../contract/json.ts";
import type { ReadOutcome } from "../contract/result.ts";
import { join, noteLines } from "./layout.ts";

export interface JsonFormatterOptions {
  /** Default: the whole outcome. */
  pick?: (outcome: ReadOutcome) => JsonObject;
  /** "inside" (default) puts notes in the JSON; "after" adds note lines after it. */
  notes?: "inside" | "after";
  space?: number;
}

/**
 * JSON text of pick(outcome), for hosts that render the result themselves.
 * With notes "after", and in "view" mode, the top-level `notes` key is left out.
 * Media bytes are left out of the JSON: each byte array becomes its length.
 * A media outcome returns the JSON text part, then its media parts.
 */
export function jsonFormatter(options: JsonFormatterOptions = {}): Formatter<unknown> {
  const pick = options.pick ?? ((outcome: ReadOutcome) => outcome as unknown as JsonObject);
  const placement = options.notes ?? "inside";
  const space = options.space ?? 0;
  const stringify = (value: JsonObject): string => JSON.stringify(value, withoutBytes, space);
  return Object.freeze<Formatter<unknown>>({
    id: "json",
    format(outcome, ctx) {
      const picked = pick(outcome);
      let text: string;
      if (placement === "inside" && ctx.mode === "model") {
        text = stringify(picked);
      } else {
        const json = stringify(withoutNotes(picked));
        text = ctx.mode === "view" ? json : join(json, noteLines(outcome.notes, {}));
      }
      if (outcome.status !== "media") return text;
      return [{ type: "text", text }, ...outcome.parts.filter((part) => part.type === "media")];
    },
  });
}

function withoutBytes(_key: string, value: unknown): unknown {
  return value instanceof Uint8Array ? { bytes: value.byteLength } : value;
}

function withoutNotes(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "notes"));
}
