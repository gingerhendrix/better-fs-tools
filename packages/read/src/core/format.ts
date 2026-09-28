import type { ReadContext } from "../contract/context.ts";
import type { ReadDependencies } from "../contract/deps.ts";
import type { ReadFormatContext } from "../contract/format.ts";
import type { ContentPart, ReadReport, ReadResult } from "../contract/result.ts";
import { lineNumberFormatter } from "../formatters/index.ts";
import { extensionId } from "./extension-error.ts";

/**
 * Runs the formatter last, in "model" mode. A string becomes one text part.
 * A formatter that throws or returns something else gives an extension-failed
 * warning, and the default formatter formats the outcome. The status stays.
 */
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
  } catch {
    // Falls through to the default formatter.
  }
  if (content !== null) return { ...outcome, content };
  const id = extensionId(deps.formatter);
  const failed: ReadReport = {
    ...outcome,
    notes: [
      ...outcome.notes,
      {
        code: "extension-failed",
        severity: "warning",
        message: deps.messages.formatterFailed({ formatter: id ?? "formatter" }),
        data: id === null ? { extension: "formatter" } : { extension: "formatter", id },
      },
    ],
  };
  return { ...failed, content: toContent(lineNumberFormatter().format(failed, ctx)) ?? [] };
}

function toContent(output: unknown): readonly ContentPart[] | null {
  if (typeof output === "string") return [{ type: "text", text: output }];
  return Array.isArray(output) ? [...(output as ContentPart[])] : null;
}

/** Joins the text parts of `result.content` with "\n". Works on any tool's result. */
export function textOf(result: { readonly content: readonly ContentPart[] }): string {
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
