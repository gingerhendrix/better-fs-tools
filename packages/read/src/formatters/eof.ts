import type { ReadReport } from "../contract/result.ts";
import type { LineNumberFormatterOptions } from "./line-number.ts";

/**
 * An end-of-file footer, shown only when the view ends at the file's last line
 * and the total is exact. An empty file counts. Directory listings and views a
 * hook emptied do not.
 */
export function eofFooter(
  text: (totalLines: number) => string = (n) => `(End of file - total ${n} lines)`,
): NonNullable<LineNumberFormatterOptions["footer"]> {
  return (outcome) => {
    const total = eofTotal(outcome);
    return total === null ? null : text(total);
  };
}

function eofTotal(outcome: ReadReport): number | null {
  if (outcome.status !== "ok" || outcome.classification.kind === "directory") return null;
  const total = outcome.totals.lines;
  if (!outcome.totals.exact || total === null || outcome.continuation.available) return null;
  const last = outcome.view.lines.at(-1)?.number ?? 0;
  return last === total ? total : null;
}
