import type { ContentPart, ToolCallContext } from "@better-fs-tools/read";

import type { WriteDependencies } from "../contract/deps.ts";
import type { WriteFormatContext } from "../contract/format.ts";
import type { MutationReport, MutationResult } from "../contract/result.ts";
import { defaultWriteFormatter } from "../formatters/default.ts";
import { extensionId } from "./extension-error.ts";

/**
 * Runs the formatter last, in "model" mode. A string becomes one text part.
 * A formatter that throws or returns something else gives an extension-failed
 * warning, and the default formatter formats the report. The status, changes,
 * and commit report stay, so a committed change is never reported as lost.
 */
export function formatResult<THost>(
  deps: WriteDependencies<THost>,
  call: ToolCallContext<THost>,
  report: MutationReport,
): MutationResult {
  const ctx: WriteFormatContext<THost> = {
    digest: deps.digest,
    limits: deps.limits,
    mode: "model",
    call,
  };
  let content: readonly ContentPart[] | null = null;
  try {
    content = toContent(deps.formatter.format(report, ctx));
  } catch {
    // Falls through to the default formatter.
  }
  if (content !== null) return { ...report, content };
  const id = extensionId(deps.formatter);
  const failed: MutationReport = {
    ...report,
    notes: [
      ...report.notes,
      {
        code: "extension-failed",
        severity: "warning",
        message: deps.messages.formatterFailed({ formatter: id ?? "formatter" }),
        data: id === null ? { extension: "formatter" } : { extension: "formatter", id },
      },
    ],
  };
  return { ...failed, content: toContent(defaultWriteFormatter().format(failed, ctx)) ?? [] };
}

function toContent(output: unknown): readonly ContentPart[] | null {
  if (typeof output === "string") return [{ type: "text", text: output }];
  return Array.isArray(output) ? [...(output as ContentPart[])] : null;
}
