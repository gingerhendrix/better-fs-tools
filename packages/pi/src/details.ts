import type { ReadResult } from "@better-fs-tools/read";

/** Pi's published TruncationResult. Fields and meanings are Pi's. */
export interface PiTruncationResult {
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  lastLinePartial: boolean;
  firstLineExceedsLimit: boolean;
  maxLines: number;
  maxBytes: number;
}

/** Empty unless the read stopped at exactly a line or byte limit. */
export interface PiReadDetails {
  truncation?: PiTruncationResult;
}

/**
 * Converts a read result to Pi's read details, from which Pi prints "showing
 * N of M lines". `view` is the formatted text in "view" mode, or null. Returns
 * {} unless the read stopped exactly at a line or byte limit with an exact
 * total, because an approximate count is worse than none.
 */
export function toPiReadDetails(
  result: ReadResult,
  view: string | null,
  maxViewBytes: number,
): PiReadDetails {
  if (view === null) return {};
  if (result.status !== "ok" || !result.totals.exact || result.totals.lines === null) return {};
  const primary = result.truncation.primary;
  if (!result.truncation.truncated || (primary !== "lines" && primary !== "bytes")) return {};

  return {
    truncation: {
      content: view,
      truncated: true,
      truncatedBy: primary,
      totalLines: result.totals.lines,
      totalBytes: result.totals.bytes,
      outputLines: result.view.lines.length,
      outputBytes: result.view.bytes,
      lastLinePartial: false,
      firstLineExceedsLimit: primary === "bytes" && result.view.lines.length === 0,
      maxLines: result.request.limit,
      maxBytes: maxViewBytes,
    },
  };
}
