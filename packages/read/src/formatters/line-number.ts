import type { ReadFormatContext, ReadFormatter } from "../contract/format.ts";
import type { ReadLine } from "../contract/result.ts";
import { layout, withParts } from "./layout.ts";
import type { LayoutOptions } from "./layout.ts";

export interface LineNumberFormatterOptions extends LayoutOptions {
  /** Default: `${line.number}|`. */
  gutter?: (line: ReadLine, ctx: ReadFormatContext<unknown>) => string;
  /** Default: `… [line truncated at ${n} chars]`. */
  clampMarker?: (line: ReadLine) => string;
}

/** Numbered lines, then notes. Media outcomes: note text part, then media parts. */
export function lineNumberFormatter(
  options: LineNumberFormatterOptions = {},
): ReadFormatter<unknown> {
  const gutter = options.gutter ?? defaultGutter;
  const clampMarker = options.clampMarker ?? defaultClampMarker;
  return Object.freeze<ReadFormatter<unknown>>({
    id: "line-number",
    format(outcome, ctx) {
      const body =
        outcome.status === "ok"
          ? outcome.view.lines
              .map(
                (line) =>
                  `${gutter(line, ctx)}${line.text}${line.clamped ? clampMarker(line) : ""}`,
              )
              .join("\n")
          : "";
      return withParts(outcome, layout(outcome, ctx, body, options));
    },
  });
}

function defaultGutter(line: ReadLine): string {
  return `${line.number}|`;
}

function defaultClampMarker(line: ReadLine): string {
  return `… [line truncated at ${line.text.length} chars]`;
}
