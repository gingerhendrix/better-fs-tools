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
 */
export function jsonFormatter(options: JsonFormatterOptions = {}): Formatter<unknown> {
  const pick = options.pick ?? ((outcome: ReadOutcome) => outcome as unknown as JsonObject);
  const placement = options.notes ?? "inside";
  const space = options.space ?? 0;
  return Object.freeze<Formatter<unknown>>({
    id: "json",
    format(outcome, ctx) {
      const picked = pick(outcome);
      if (placement === "inside" && ctx.mode === "model") {
        return JSON.stringify(picked, null, space);
      }
      const json = JSON.stringify(withoutNotes(picked), null, space);
      if (ctx.mode === "view") return json;
      return join(json, noteLines(outcome.notes, {}));
    },
  });
}

function withoutNotes(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "notes"));
}
