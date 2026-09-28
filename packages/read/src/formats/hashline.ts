import type { ReadFormatter } from "../contract/format.ts";
import { eofFooter } from "../formatters/eof.ts";
import { fileHashHeader } from "../formatters/file-hash.ts";
import { hashlineGutter } from "../formatters/hashline.ts";
import { lineNumberFormatter } from "../formatters/line-number.ts";
import { preset } from "./shared.ts";

/**
 * Hashline style: a file hash line, then `12:a3|text` lines, and an
 * end-of-file line. Directory entries get plain `1|` numbers.
 */
export function hashlineFormat(): ReadFormatter<unknown> {
  return preset(
    "hashline",
    lineNumberFormatter({
      gutter: hashlineGutter(),
      header: fileHashHeader(),
      footer: eofFooter(),
    }),
    lineNumberFormatter(),
  );
}
