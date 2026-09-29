import type { WriteRequest } from "../contract/input.ts";
import type { Loaded } from "./load.ts";
import { plannedChange, toTextSpace } from "./planned.ts";
import type { Planned, ResolvedTarget } from "./planned.ts";
import type { PreconditionResult } from "./precondition.ts";
import type { MutationScope } from "./scope.ts";

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
    rematchedAfterStale: false,
    matches: [],
    snippets: [],
  };
}
