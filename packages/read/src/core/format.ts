import type { ReadContext } from "../contract/context.ts";
import type { ReadDependencies } from "../contract/deps.ts";
import type { ReadFormatContext } from "../contract/format.ts";
import type { ContentPart, ReadReport, ReadResult } from "../contract/result.ts";
import { lineNumberFormatter } from "../formatters/index.ts";

export function formatResult<THost>(
  deps: ReadDependencies<THost>,
  call: ReadContext<THost>,
  outcome: ReadReport,
): ReadResult {
  const ctx: ReadFormatContext<THost> = {
    digest: deps.digest,
    limits: deps.limits,
    mode: "model",
    call,
  };
  let content: readonly ContentPart[] | null = null;
  try {
    content = toContent(deps.formatter.format(outcome, ctx));
  } catch {}
  if (content !== null) return { ...outcome, content };
  return { ...outcome, content: toContent(lineNumberFormatter().format(outcome, ctx)) ?? [] };
}

function toContent(output: unknown): readonly ContentPart[] | null {
  if (typeof output === "string") return [{ type: "text", text: output }];
  return Array.isArray(output) ? [...(output as ContentPart[])] : null;
}

/** The text parts of any tool result's `content`, joined with newlines. */
export function textOf(result: { readonly content: readonly ContentPart[] }): string {
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
