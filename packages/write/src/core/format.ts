import type { ContentPart, ToolCallContext } from "@better-fs-tools/read";

import type { WriteDependencies } from "../contract/deps.ts";
import type { WriteFormatContext } from "../contract/format.ts";
import type { MutationReport, MutationResult } from "../contract/result.ts";
import { defaultWriteFormatter } from "../formatters/default.ts";

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
  } catch {}
  if (content !== null) return { ...report, content };
  return { ...report, content: toContent(defaultWriteFormatter().format(report, ctx)) ?? [] };
}

function toContent(output: unknown): readonly ContentPart[] | null {
  if (typeof output === "string") return [{ type: "text", text: output }];
  return Array.isArray(output) ? [...(output as ContentPart[])] : null;
}
