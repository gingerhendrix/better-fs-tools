import type { Formatter } from "../contract/format.ts";
import { layout } from "./layout.ts";
import type { LineNumberFormatterOptions } from "./line-number.ts";

/**
 * Source text with no gutter and no clamp marker. A host that pastes model
 * output back into an edit call wants this. It trades line numbers for exact text.
 */
export function plainFormatter(
  options: Omit<LineNumberFormatterOptions, "gutter" | "clampMarker"> = {},
): Formatter<unknown> {
  return Object.freeze<Formatter<unknown>>({
    id: "plain",
    format(outcome, ctx) {
      const body =
        outcome.status === "ok" ? outcome.view.lines.map((line) => line.text).join("\n") : "";
      return layout(outcome, ctx, body, options);
    },
  });
}
