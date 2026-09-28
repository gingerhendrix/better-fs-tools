import type { ToolCallContext } from "@better-fs-tools/read";

import type { EditDependencies, WriteDependencies } from "../contract/deps.ts";
import type { EditRequest, MutationRequest, WriteRequest } from "../contract/input.ts";
import type { MutationReport, MutationResult } from "../contract/result.ts";
import { AbortStop } from "./abort.ts";
import { authorizeAccess, authorizeChanges } from "./authorize.ts";
import { commitOne, fileChange } from "./commit.ts";
import { encodePlanned } from "./encode.ts";
import { formatResult } from "./format.ts";
import { runGuards } from "./guards.ts";
import { committedFile, runWriteHooks } from "./hooks.ts";
import type { MissCounter } from "./hints.ts";
import { isRecord, parseEditInput, parseWriteInput } from "./input.ts";
import { loadFile } from "./load.ts";
import type { Loaded } from "./load.ts";
import { acquireLocks } from "./lock.ts";
import { WriteStop, errorNote, failure, messageOf } from "./outcomes.ts";
import { planEdit } from "./plan-edit.ts";
import { planWrite } from "./plan-write.ts";
import { withContent } from "./planned.ts";
import type { Planned, ResolvedTarget } from "./planned.ts";
import { checkPrecondition } from "./precondition.ts";
import type { PreconditionResult } from "./precondition.ts";
import { recordCommitted } from "./record.ts";
import { resolvePath } from "./resolve.ts";
import { MutationScope } from "./scope.ts";
import { statAgain, statTarget } from "./target.ts";

/** One write call, start to end. */
export async function runWrite<THost>(
  deps: WriteDependencies<THost>,
  input: unknown,
  call: ToolCallContext<THost>,
): Promise<MutationResult> {
  let request: WriteRequest;
  try {
    request = parseWriteInput(input, deps.limits);
  } catch (error) {
    return formatResult(deps, call, invalidInput(deps, "write", input, error));
  }
  const report = await runSingleFile(deps, request, call, {
    missing: "create",
    plan: (scope, target, loaded, pre) => planWrite(scope, request, target, loaded, pre),
    sameBytes: "no-change",
  });
  return formatResult(deps, call, report);
}

/** One edit call, start to end. `misses` counts NO_MATCH results for this tool instance. */
export async function runEdit<THost>(
  deps: EditDependencies<THost>,
  input: unknown,
  call: ToolCallContext<THost>,
  misses: MissCounter,
): Promise<MutationResult> {
  let request: EditRequest;
  try {
    request = parseEditInput(input, deps.limits);
  } catch (error) {
    return formatResult(deps, call, invalidInput(deps, "edit", input, error));
  }
  const { matchers } = deps;
  const report = await runSingleFile(deps, request, call, {
    missing: "not-found",
    plan: (scope, target, loaded, pre) =>
      planEdit(scope, { request, matchers, misses }, target, loaded, pre),
    sameBytes: "error",
  });
  return formatResult(deps, call, report);
}

/** What differs between the single-file tools, write and edit. */
export interface SingleFilePlan<THost> {
  /** "create": a missing target is a create. "not-found": it ends the call with NOT_FOUND. */
  readonly missing: "create" | "not-found";
  readonly plan: (
    scope: MutationScope<THost>,
    target: ResolvedTarget,
    loaded: Loaded | null,
    pre: PreconditionResult,
  ) => Planned | "no-change";
  /** What encoded bytes equal to the loaded bytes mean. */
  readonly sameBytes: "no-change" | "error";
}

/**
 * The stage order for one file: resolve, stat, access authorize, lock, stat
 * again, load, precondition, plan, guards, change authorize (W6), encode,
 * commit, hooks, record. Never throws: a stage that stops the call gives
 * an error report with the notes gathered so far.
 */
export async function runSingleFile<THost>(
  deps: WriteDependencies<THost>,
  request: Extract<MutationRequest, { readonly path: string }>,
  call: ToolCallContext<THost>,
  tool: SingleFilePlan<THost>,
): Promise<MutationReport> {
  const scope = new MutationScope(deps, request, call);
  try {
    return await singleFileStages(scope, request.path, tool);
  } catch (error) {
    const report = stopped(scope, error);
    return { ...report, notes: [...report.notes, ...scope.notes] };
  }
}

async function singleFileStages<THost>(
  scope: MutationScope<THost>,
  requested: string,
  tool: SingleFilePlan<THost>,
): Promise<MutationReport> {
  const { messages, limits } = scope.deps;
  scope.enter("resolve");
  scope.checkAbort();
  const fs = scope.fileSystem();
  const path = await resolvePath(scope, fs, requested);
  const target = { requestedPath: requested, path };
  const notFound = () =>
    scope.stop("NOT_FOUND", messages.notFound({ tool: scope.tool, path: requested }));

  const first = await statTarget(scope, fs, target);
  if (!first.exists && tool.missing === "not-found") throw notFound();
  await authorizeAccess(scope, [
    { action: first.exists ? "update" : "create", target: resolved(requested, first) },
  ]);

  const release = await acquireLocks(scope, [first.resolvedPath], [requested]);
  try {
    const stat = await statAgain(scope, fs, target, first);
    if (!stat.exists && tool.missing === "not-found") throw notFound();
    const loaded = stat.exists ? await loadFile(scope, fs, stat, requested) : null;
    const pre = await checkPrecondition(scope, fs, stat, loaded, requested);
    const resolvedTarget = resolved(requested, stat);
    let planned = tool.plan(scope, resolvedTarget, loaded, pre);
    if (planned === "no-change") return noChange(scope, resolvedTarget.displayPath);

    await runGuards(scope, [planned.change]);
    const [content] = await authorizeChanges(scope, [planned.change]);
    if (content !== null && content !== undefined) {
      scope.enter("plan");
      planned = withContent(planned, content, limits);
      scope.notes.push({
        code: "user-modified",
        severity: "warning",
        message: messages.userModified({ path: resolvedTarget.displayPath }),
      });
      await runGuards(scope, [planned.change]);
    }

    const bytes = encodePlanned(scope, planned);
    if (bytes === "same") {
      if (tool.sameBytes === "no-change") return noChange(scope, resolvedTarget.displayPath);
      throw scope.stop("NO_CHANGE", messages.noChange({ path: requested }));
    }
    const mutated = await commitOne(scope, fs, planned, bytes);
    const committed = [
      committedFile(scope, planned, fileChange(scope, planned, bytes, mutated), mutated),
    ];
    await runWriteHooks(scope, fs, committed);
    await recordCommitted(scope, committed);
    return {
      tool: scope.tool,
      status: "ok",
      changes: committed.map((file) => file.change),
      unchanged: [],
      notes: [...scope.notes],
      commit: null,
    };
  } finally {
    release();
  }
}

function resolved(
  requestedPath: string,
  stat: { readonly resolvedPath: string; readonly displayPath: string },
): ResolvedTarget {
  return { requestedPath, resolvedPath: stat.resolvedPath, displayPath: stat.displayPath };
}

export function noChange<THost>(
  scope: MutationScope<THost>,
  ...paths: readonly string[]
): MutationReport {
  return {
    tool: scope.tool,
    status: "no-change",
    changes: [],
    unchanged: [...paths],
    notes: [...scope.notes],
    commit: null,
  };
}

/** The report for a stage that threw. */
export function stopped<THost>(scope: MutationScope<THost>, error: unknown): MutationReport {
  if (error instanceof WriteStop) return error.report;
  const { messages } = scope.deps;
  if (error instanceof AbortStop) {
    const { phase } = scope;
    return failure(scope.tool, phase, errorNote("ABORTED", messages.aborted({ phase }), { phase }));
  }
  const note = errorNote("IO_ERROR", messages.ioError({ path: scope.path }), {
    detail: messageOf(error),
  });
  return failure(scope.tool, scope.phase, note);
}

export function invalidInput<THost>(
  deps: WriteDependencies<THost>,
  tool: MutationRequest["tool"],
  input: unknown,
  error: unknown,
): MutationReport {
  const path = isRecord(input) && typeof input.path === "string" ? input.path : "";
  const note = errorNote(
    "INVALID_INPUT",
    deps.messages.invalidInput({ tool, detail: messageOf(error) }),
    path === "" ? undefined : { path },
  );
  return failure(tool, "input", note);
}
