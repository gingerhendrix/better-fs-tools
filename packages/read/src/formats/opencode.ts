import type { FormatContext, Formatter } from "../contract/format.ts";
import type { ReadOutcome } from "../contract/result.ts";
import { eofFooter } from "../formatters/eof.ts";
import { lineNumberFormatter } from "../formatters/line-number.ts";
import { plainFormatter } from "../formatters/plain.ts";
import { isDirectory, preset } from "./shared.ts";

const eof = eofFooter();

/**
 * OpenCode style: path and type tags, then `1: text` lines in `<content>`,
 * and an end-of-file line. Directory entries go in `<entries>` with no
 * numbers. Notes follow the closing tag.
 */
export function opencodeFormat(): Formatter<unknown> {
  const options = { header, footer };
  return preset(
    "opencode",
    lineNumberFormatter({ ...options, gutter: (line) => `${line.number}: ` }),
    plainFormatter(options),
  );
}

function header(outcome: ReadOutcome): string | null {
  if (outcome.status === "media") {
    return `<path>${outcome.file.displayPath}</path>\n<type>media</type>`;
  }
  if (outcome.status !== "ok") return null;
  const directory = isDirectory(outcome);
  return [
    `<path>${outcome.file.displayPath}</path>`,
    `<type>${directory ? "directory" : "file"}</type>`,
    directory ? "<entries>" : "<content>",
  ].join("\n");
}

function footer(outcome: ReadOutcome, ctx: FormatContext<unknown>): string | null {
  if (outcome.status !== "ok") return null;
  if (isDirectory(outcome)) return "</entries>";
  const end = eof(outcome, ctx);
  return end === null ? "</content>" : `\n${end}\n</content>`;
}
