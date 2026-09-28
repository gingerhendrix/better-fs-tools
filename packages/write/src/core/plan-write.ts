import type { WriteRequest } from "../contract/input.ts";
import type { Loaded } from "./load.ts";
import { plannedChange, toTextSpace } from "./planned.ts";
import type { Planned, ResolvedTarget } from "./planned.ts";
import type { PreconditionResult } from "./precondition.ts";
import type { MutationScope } from "./scope.ts";

/**
 * Section 5.6. A create takes the content as given, in the first codec's
 * new-file style, and creates missing parents. A replace keeps the loaded
 * style: for a "crlf" file, CRLF in the content becomes LF, and encode
 * restores CRLF. The same text as the loaded text is "no-change".
 */
export function planWrite<THost>(
  scope: MutationScope<THost>,
  request: WriteRequest,
  target: ResolvedTarget,
  loaded: Loaded | null,
  pre: PreconditionResult,
): Planned | "no-change" {
  scope.enter("plan");
  scope.checkAbort();
  const { codecs, limits } = scope.deps;
  const codec = loaded?.codec ?? (codecs[0] as (typeof codecs)[number]);
  const style = loaded?.style ?? codec.newFileStyle;
  const text = toTextSpace(request.content, style);
  if (loaded !== null && text === loaded.text) return "no-change";
  const { change, diffTruncated } = plannedChange(
    "write",
    target,
    loaded,
    text,
    style,
    [{ oldText: loaded?.text ?? "", newText: text }],
    limits.maxDiffLines,
  );
  return {
    change,
    diffTruncated,
    target,
    loaded,
    codec,
    style,
    precondition: pre.precondition,
    createParents: loaded === null,
    record: pre.record,
    userModified: false,
  };
}
