import type { ReadFormatter } from "../contract/format.ts";
import { layout, withParts } from "./layout.ts";
import type { LineNumberFormatterOptions } from "./line-number.ts";

/**
 * Source text with no gutter and no clamp marker, then notes. It trades line
 * numbers for exact text, for hosts whose model pastes output into an edit call.
 */
export function plainFormatter(
  options: Omit<LineNumberFormatterOptions, "gutter" | "clampMarker"> = {},
): ReadFormatter<unknown> {
  return Object.freeze<ReadFormatter<unknown>>({
    id: "plain",
    format(outcome, ctx) {
      const body =
        outcome.status === "ok" ? outcome.view.lines.map((line) => line.text).join("\n") : "";
      return withParts(outcome, layout(outcome, ctx, body, options));
    },
  });
}
