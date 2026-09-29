import type { JsonObject } from "@better-fs-tools/read";

import type { Matcher } from "../contract/matcher.ts";
import type { PatchOperation } from "../contract/patch.ts";
import { exactMatcher } from "../matchers/exact.ts";
import { unifiedDiff } from "./diff.ts";
import type { Loaded } from "./load.ts";
import { applyHunks } from "./patch-hunks.ts";
import type { HunkProblem } from "./patch-hunks.ts";
import { plannedChange } from "./planned.ts";
import type { Planned, ResolvedTarget } from "./planned.ts";
import type { PreconditionResult } from "./precondition.ts";
import type { MutationScope } from "./scope.ts";
import { buildSnippets } from "./snippet.ts";

const STALE_REMATCH_MATCHER = exactMatcher();

export interface PatchTarget {
  readonly op: PatchOperation;
  readonly main: ResolvedTarget;
  readonly dest: ResolvedTarget | null;
  readonly loaded: Loaded | null;
  readonly pre: PreconditionResult | null;
}

export interface PatchChange {
  readonly planned: Planned;
  readonly source: ResolvedTarget | null;
}

export interface PatchProblem {
  readonly path: string;
  readonly line: number;
  readonly reason:
    | "duplicate"
    | "unsupported"
    | "exists"
    | "not-found"
    | "move-exists"
    | "context-not-found"
    | "lines-not-found";
  readonly message: string;
  readonly hunk?: number;
}

export function planPatch<THost>(
  scope: MutationScope<THost>,
  matchers: readonly Matcher[],
  targets: readonly PatchTarget[],
  problems: PatchProblem[],
): { readonly changes: PatchChange[]; readonly unchanged: string[] } {
  scope.enter("plan");
  scope.checkAbort();
  const { limits, messages } = scope.deps;
  const changes: PatchChange[] = [];
  const unchanged: string[] = [];
  for (const target of targets) {
    if (problems.length >= limits.maxPatchProblems) break;
    const { op, main, loaded } = target;
    if (op.kind === "add") {
      changes.push({ planned: planAdd(scope, main, op.content), source: null });
      continue;
    }
    if (loaded === null || target.pre === null) continue;
    if (op.kind === "delete") {
      // A delete has no hunk to show the model saw the changed file.
      if (target.pre.mustRematch) throw staleFailure(scope, main.requestedPath);
      changes.push({ planned: planDelete(scope, main, loaded, target.pre), source: null });
      continue;
    }
    const { pre } = target;
    const outcome = applyHunks(
      scope,
      pre.mustRematch ? [STALE_REMATCH_MATCHER] : matchers,
      loaded.text,
      op.hunks,
    );
    if (!outcome.ok) {
      if (pre.mustRematch) throw staleFailure(scope, main.requestedPath, outcome.problem.hunk);
      problems.push(hunkProblem(scope, main.requestedPath, op.line, outcome.problem));
      continue;
    }
    const dest = target.dest;
    if (dest === null && outcome.text === loaded.text) {
      unchanged.push(main.displayPath);
      continue;
    }
    const { change, diffTruncated, changed } = plannedChange(
      "apply_patch",
      dest ?? main,
      loaded,
      outcome.text,
      loaded.style,
      outcome.fragments,
      limits.maxDiffLines,
      dest === null ? null : main,
    );
    changes.push({
      planned: {
        change,
        diffTruncated,
        target: dest ?? main,
        loaded,
        codec: loaded.codec,
        style: loaded.style,
        precondition: dest === null ? pre.precondition : { kind: "absent" },
        createParents: dest !== null,
        record: pre.record,
        userModified: false,
        rematchedAfterStale: pre.mustRematch,
        matches: outcome.matches,
        snippets: buildSnippets(outcome.text, changed, limits),
      },
      source: dest === null ? null : main,
    });
    if (pre.mustRematch) {
      scope.notes.push({
        code: "stale-rematched",
        severity: "info",
        message: messages.staleRematched({ path: main.displayPath }),
      });
    }
    for (const match of outcome.matches) {
      if (!match.fuzzy) continue;
      scope.notes.push({
        code: "fuzzy-match",
        severity: "info",
        message: messages.patchFuzzyMatch({
          path: main.displayPath,
          hunk: match.index + 1,
          matcher: match.matcher,
          lines: match.lines,
        }),
        data: { path: main.displayPath, hunk: match.index, matcher: match.matcher },
      });
    }
  }
  if (problems.length > 0) throw verifyFailure(scope, problems);
  return { changes, unchanged };
}

export function verifyFailure<THost>(
  scope: MutationScope<THost>,
  problems: readonly PatchProblem[],
) {
  const { messages, limits } = scope.deps;
  const shown = [...problems].sort((a, b) => a.line - b.line).slice(0, limits.maxPatchProblems);
  const message = [messages.patchVerifyHeader(), ...shown.map((problem) => `- ${problem.message}`)];
  const data = shown.map((problem): JsonObject => ({
    path: problem.path,
    reason: problem.reason,
    ...(problem.hunk === undefined ? {} : { hunk: problem.hunk }),
  }));
  return scope.stop("PATCH_VERIFY", message.join("\n"), { problems: data });
}

function staleFailure<THost>(scope: MutationScope<THost>, path: string, hunk?: number) {
  scope.enter("precondition");
  const message = scope.deps.messages.stale({ tool: scope.tool, path });
  return scope.stop("STALE", message, hunk === undefined ? { path } : { path, hunk });
}

function hunkProblem<THost>(
  scope: MutationScope<THost>,
  path: string,
  line: number,
  problem: HunkProblem,
): PatchProblem {
  const { messages } = scope.deps;
  const hunk = problem.hunk + 1;
  const message =
    problem.reason === "context-not-found"
      ? messages.patchContextNotFound({ path, hunk, context: problem.context })
      : messages.patchLinesNotFound({ path, hunk, lines: problem.lines });
  return { path, line, reason: problem.reason, message, hunk: problem.hunk };
}

function planAdd<THost>(
  scope: MutationScope<THost>,
  target: ResolvedTarget,
  content: string,
): Planned {
  const { codecs, limits } = scope.deps;
  const codec = codecs[0] as (typeof codecs)[number];
  const style = codec.newFileStyle;
  const { change, diffTruncated } = plannedChange(
    "apply_patch",
    target,
    null,
    content,
    style,
    [{ oldText: "", newText: content }],
    limits.maxDiffLines,
  );
  return {
    change,
    diffTruncated,
    target,
    loaded: null,
    codec,
    style,
    precondition: { kind: "absent" },
    createParents: true,
    record: null,
    userModified: false,
    rematchedAfterStale: false,
    matches: [],
    snippets: [],
  };
}

function planDelete<THost>(
  scope: MutationScope<THost>,
  target: ResolvedTarget,
  loaded: Loaded,
  pre: PreconditionResult,
): Planned {
  const diff = unifiedDiff(loaded.text, null, target.displayPath, scope.deps.limits.maxDiffLines);
  return {
    change: {
      tool: "apply_patch",
      kind: "delete",
      requestedPath: target.requestedPath,
      resolvedPath: target.resolvedPath,
      displayPath: target.displayPath,
      movedFrom: null,
      before: {
        text: loaded.text,
        style: loaded.style,
        contentId: loaded.contentId,
        version: loaded.version,
      },
      after: null,
      fragments: [],
      linesAdded: diff.linesAdded,
      linesRemoved: diff.linesRemoved,
      diff: diff.text,
    },
    diffTruncated: diff.truncated,
    target,
    loaded,
    codec: loaded.codec,
    style: loaded.style,
    precondition: pre.precondition,
    createParents: false,
    record: pre.record,
    userModified: false,
    rematchedAfterStale: pre.mustRematch,
    matches: [],
    snippets: [],
  };
}
