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
import { withAuthorizerContent } from "./planned.ts";
import type { Planned, ResolvedTarget } from "./planned.ts";
import { checkPrecondition } from "./precondition.ts";
import type { PreconditionResult } from "./precondition.ts";
import { recordCommitted } from "./record.ts";
import { resolvePath } from "./resolve.ts";
import { MutationScope } from "./scope.ts";
import { statAgain, statTarget } from "./target.ts";

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
    whenMissing: "create",
    plan: (scope, target, loaded, pre) => planWrite(scope, request, target, loaded, pre),
    whenSameBytes: "no-change",
  });
  return formatResult(deps, call, report);
}

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
    whenMissing: "not-found",
    plan: (scope, target, loaded, pre) =>
      planEdit(scope, { request, matchers, misses }, target, loaded, pre),
    whenSameBytes: "error",
  });
  return formatResult(deps, call, report);
}

export interface SingleFilePlan<THost> {
  readonly whenMissing: "create" | "not-found";
  readonly plan: (
    scope: MutationScope<THost>,
    target: ResolvedTarget,
    loaded: Loaded | null,
    pre: PreconditionResult,
  ) => Planned | "no-change";
  readonly whenSameBytes: "no-change" | "error";
}

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
  scope.checkAbort();
  scope.enter("resolve");
  const fs = scope.fileSystem();
  const path = await resolvePath(scope, fs, requested);
  const target = { requestedPath: requested, path };
  const notFound = () =>
    scope.stop("NOT_FOUND", messages.notFound({ tool: scope.tool, path: requested }));

  const first = await statTarget(scope, fs, target);
  if (!first.exists && tool.whenMissing === "not-found") throw notFound();
  await authorizeAccess(scope, [
    { action: first.exists ? "update" : "create", target: resolved(requested, first) },
  ]);

  const release = await acquireLocks(scope, [first.resolvedPath], [requested]);
  try {
    const stat = await statAgain(scope, fs, target, first);
    if (!stat.exists && tool.whenMissing === "not-found") throw notFound();
    const loaded = stat.exists ? await loadFile(scope, fs, stat, requested) : null;
    const pre = await checkPrecondition(scope, fs, stat, loaded, requested);
    const resolvedTarget = resolved(requested, stat);
    let planned = tool.plan(scope, resolvedTarget, loaded, pre);
    if (planned === "no-change") return noChange(scope, resolvedTarget.displayPath);

    await runGuards(scope, [planned.change]);
    const [content] = await authorizeChanges(scope, [planned.change]);
    if (content !== null && content !== undefined) {
      scope.enter("plan");
      planned = withAuthorizerContent(planned, content, limits);
      scope.notes.push({
        code: "user-modified",
        severity: "warning",
        message: messages.userModified({ path: resolvedTarget.displayPath }),
      });
      await runGuards(scope, [planned.change]);
    }

    const bytes = encodePlanned(scope, planned);
    if (bytes === "same") {
      if (tool.whenSameBytes === "no-change") return noChange(scope, resolvedTarget.displayPath);
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
