import type { EditRequest } from "../contract/input.ts";
import type { Matcher } from "../contract/matcher.ts";
import type { MatchInfo } from "../contract/result.ts";
import { exactMatcher } from "../matchers/exact.ts";
import { closestRegion, isAlreadyApplied, trailingNewline } from "./hints.ts";
import type { MissCounter } from "./hints.ts";
import { LineIndex } from "./line-index.ts";
import type { Loaded } from "./load.ts";
import { REPLACE_ALL_CAP, adaptFor, escapeDrift, findWith, runChain, tooWide } from "./match.ts";
import { plannedChange, toTextSpace } from "./planned.ts";
import type { Planned, ResolvedTarget } from "./planned.ts";
import type { PreconditionResult } from "./precondition.ts";
import type { MutationScope } from "./scope.ts";
import { buildSnippets } from "./snippet.ts";
import { placed, spliceAll } from "./splice.ts";
import type { Splice } from "./splice.ts";

const STALE_REMATCH_MATCHER = exactMatcher();

type Pair = EditRequest["edits"][number];

interface Found {
  readonly index: number;
  readonly matcher: Matcher;
  readonly hits: readonly Splice[];
}

export interface EditPlanInput {
  readonly request: EditRequest;
  readonly matchers: readonly Matcher[];
  readonly misses: MissCounter;
}

export function planEdit<THost>(
  scope: MutationScope<THost>,
  input: EditPlanInput,
  target: ResolvedTarget,
  loaded: Loaded | null,
  pre: PreconditionResult,
): Planned | "no-change" {
  scope.enter("plan");
  scope.checkAbort();
  const { messages, limits } = scope.deps;
  const path = target.requestedPath;
  if (loaded === null) throw scope.stop("NOT_FOUND", messages.notFound({ tool: "edit", path }));
  const { text, style } = loaded;

  const found: Found[] = [];
  for (const [index, given] of input.request.edits.entries()) {
    const pair: Pair = {
      oldText: toTextSpace(given.oldText, style),
      newText: toTextSpace(given.newText, style),
      replaceAll: given.replaceAll,
    };
    const result = pre.mustRematch
      ? rematchAfterStale(scope, text, pair, index, path)
      : matchPair(scope, input, target, text, pair, index);
    if (result !== "applied") {
      found.push(result);
      continue;
    }
    scope.notes.push({
      code: "already-applied",
      severity: "info",
      message: messages.alreadyApplied({ path: target.displayPath, index }),
      data: { index },
    });
  }
  input.misses.reset(target.resolvedPath);
  if (found.length === 0) return "no-change";

  const hits = found
    .flatMap((pair) => pair.hits.map((hit) => ({ ...hit, index: pair.index })))
    .sort((a, b) => a.start - b.start);
  for (let at = 1; at < hits.length; at += 1) {
    const previous = hits[at - 1] as (typeof hits)[number];
    const current = hits[at] as (typeof hits)[number];
    if (previous.end <= current.start) continue;
    const first = Math.min(previous.index, current.index);
    const second = Math.max(previous.index, current.index);
    throw scope.stop("OVERLAP", messages.overlap({ path, first, second }), { first, second });
  }
  const after = spliceAll(text, hits);
  if (after === text) throw scope.stop("NO_CHANGE", messages.noChange({ path }));

  if (pre.mustRematch) {
    scope.notes.push({
      code: "stale-rematched",
      severity: "info",
      message: messages.staleRematched({ path: target.displayPath }),
    });
  }
  const before = new LineIndex(text);
  const afterIndex = new LineIndex(after);
  const spans = placed(hits).map(({ start, end }) => afterIndex.span(start, end));
  const byPair = new Map<number, [number, number][]>();
  for (const [at, span] of spans.entries()) {
    const index = (hits[at] as (typeof hits)[number]).index;
    const list = byPair.get(index) ?? [];
    if (list.length < limits.maxListedMatches) list.push(span);
    byPair.set(index, list);
  }
  const matches = found.map((pair): MatchInfo => {
    const first = pair.hits[0] as Splice;
    return {
      index: pair.index,
      matcher: pair.matcher.id,
      fuzzy: pair.matcher.fuzzy,
      lines: before.span(first.start, first.end),
      count: pair.hits.length,
      replaced: byPair.get(pair.index) ?? [],
    };
  });
  for (const match of matches) {
    if (!match.fuzzy) continue;
    scope.notes.push({
      code: "fuzzy-match",
      severity: "info",
      message: messages.fuzzyMatch({
        path: target.displayPath,
        index: match.index,
        matcher: match.matcher,
        lines: match.lines,
      }),
      data: { index: match.index, matcher: match.matcher, lines: [...match.lines] },
    });
  }

  const fragments = found.map((pair) => {
    const first = pair.hits[0] as Splice;
    return { oldText: text.slice(first.start, first.end), newText: first.text };
  });
  const { change, diffTruncated } = plannedChange(
    "edit",
    target,
    loaded,
    after,
    style,
    fragments,
    limits.maxDiffLines,
  );
  return {
    change,
    diffTruncated,
    target,
    loaded,
    codec: loaded.codec,
    style,
    precondition: pre.precondition,
    createParents: false,
    record: pre.record,
    userModified: false,
    rematchedAfterStale: pre.mustRematch,
    matches,
    snippets: buildSnippets(afterIndex, spans, limits),
  };
}

function matchPair<THost>(
  scope: MutationScope<THost>,
  input: EditPlanInput,
  target: ResolvedTarget,
  text: string,
  pair: Pair,
  index: number,
): Found | "applied" {
  const { messages, limits } = scope.deps;
  const path = target.requestedPath;
  const listed = limits.maxListedMatches;
  const maxMatches = pair.replaceAll ? REPLACE_ALL_CAP + 1 : listed + 1;
  const chain = runChain(scope, input.matchers, text, pair.oldText, {
    mode: "text",
    from: 0,
    maxMatches,
  });
  if (chain === null) {
    if (isAlreadyApplied(text, pair.newText)) return "applied";
    throw noMatchFailure(scope, input, target, text, pair, index);
  }
  const { matcher, ranges } = chain;
  const refuse = (reason: "span" | "boundary" | "escape" | "fuzzy-replace-all" | "too-many") =>
    scope.stop(
      "MATCH_REFUSED",
      messages.matchRefused({ path, index, matcher: matcher.id, reason }),
      {
        index,
        matcher: matcher.id,
        reason,
      },
    );
  if (ranges.length > 1 && !pair.replaceAll) {
    const total =
      ranges.length > listed
        ? findWith(scope, matcher, text, pair.oldText, {
            mode: "text",
            from: 0,
            maxMatches: REPLACE_ALL_CAP,
          }).length
        : ranges.length;
    const lines = new LineIndex(text);
    const shown = ranges.slice(0, listed).map((range) => lines.lineOf(range.start));
    throw scope.stop(
      "AMBIGUOUS_MATCH",
      messages.ambiguousMatch({ path, index, lines: shown, total }),
      {
        index,
        lines: shown,
        total,
      },
    );
  }
  if (ranges.length > 1 && matcher.fuzzy) throw refuse("fuzzy-replace-all");
  if (ranges.length > REPLACE_ALL_CAP) throw refuse("too-many");
  const hits = ranges.map((range): Splice => {
    if (range.refused === "boundary") throw refuse("boundary");
    if (matcher.fuzzy && tooWide(range, pair.oldText)) throw refuse("span");
    const replacement = adaptFor(scope, matcher, pair.newText, {
      haystack: text,
      needle: pair.oldText,
      range,
    });
    if (matcher.fuzzy && escapeDrift(replacement, text.slice(range.start, range.end))) {
      throw refuse("escape");
    }
    return { start: range.start, end: range.end, text: replacement };
  });
  return { index, matcher, hits };
}

function rematchAfterStale<THost>(
  scope: MutationScope<THost>,
  text: string,
  pair: Pair,
  index: number,
  path: string,
): Found {
  const ranges = findWith(scope, STALE_REMATCH_MATCHER, text, pair.oldText, {
    mode: "text",
    from: 0,
    maxMatches: pair.replaceAll ? REPLACE_ALL_CAP + 1 : 2,
  });
  const once = pair.replaceAll ? ranges.length <= REPLACE_ALL_CAP : ranges.length === 1;
  if (ranges.length === 0 || !once) {
    scope.enter("precondition");
    throw scope.stop("STALE", scope.deps.messages.stale({ tool: "edit", path }), { index });
  }
  return {
    index,
    matcher: STALE_REMATCH_MATCHER,
    hits: ranges.map((range) => ({ start: range.start, end: range.end, text: pair.newText })),
  };
}

function noMatchFailure<THost>(
  scope: MutationScope<THost>,
  input: EditPlanInput,
  target: ResolvedTarget,
  text: string,
  pair: Pair,
  index: number,
) {
  const { messages, limits } = scope.deps;
  const path = target.requestedPath;
  const newline = trailingNewline(text, pair.oldText);
  const closest = closestRegion(text, pair.oldText, limits.maxHintLines);
  const misses = input.misses.miss(target.resolvedPath);
  if (misses >= 3) {
    scope.notes.push({
      code: "repeated-miss",
      severity: "info",
      message: messages.repeatedMiss({ path, misses }),
      data: { misses },
    });
  }
  return scope.stop(
    "NO_MATCH",
    messages.noMatch({ path, index, closest: closest?.text ?? null, trailingNewline: newline }),
    {
      index,
      ...(newline === null ? {} : { trailingNewline: newline }),
      ...(closest === null ? {} : { closest: [...closest.lines] }),
    },
  );
}
