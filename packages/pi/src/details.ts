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
 * `view` is formatter output in "view" mode, or null when the formatter returned
 * parts or the result is not a plain line or byte stop. null gives {}.
 *
 * Pi's read renderer prints "showing N of M lines" from these numbers, so an
 * approximate record is worse than none. A scan-capped read has no exact total,
 * a clamped line or a view-budget stop is not a line or byte stop, and an
 * error or a refusal has no view. Each of those gives {}, and Pi renders the
 * text alone.
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
