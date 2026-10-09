import type { FileStat, WritableFileSystem } from "@better-fs-tools/fs";
import type { ToolCallContext } from "@better-fs-tools/read";

import type { ApplyPatchDependencies } from "../contract/deps.ts";
import type { ApplyPatchRequest } from "../contract/input.ts";
import type { PatchOperation } from "../contract/patch.ts";
import type { MutationReport, MutationResult } from "../contract/result.ts";
import { authorizeAccess, authorizeChanges } from "./authorize.ts";
import type { AccessRequest } from "./authorize.ts";
import { fileChange } from "./commit.ts";
import { commitPatch, deleteChange } from "./commit-patch.ts";
import type { PatchFile, PatchStep } from "./commit-patch.ts";
import { encodePlanned } from "./encode.ts";
import { formatResult } from "./format.ts";
import { runGuards } from "./guards.ts";
import { committedFile, newFileMode, runWriteHooks } from "./hooks.ts";
import type { Committed } from "./hooks.ts";
import { parseApplyPatchInput } from "./input.ts";
import { loadFile } from "./load.ts";
import type { Loaded } from "./load.ts";
import { acquireLocks } from "./lock.ts";
import { WriteStop } from "./outcomes.ts";
import { parsePatchText } from "./parse-patch.ts";
import { invalidInput, noChange, stopped } from "./pipeline.ts";
import { planPatch, verifyFailure } from "./plan-patch.ts";
import type { PatchChange, PatchProblem, PatchTarget } from "./plan-patch.ts";
import type { ResolvedTarget } from "./planned.ts";
import { checkPrecondition } from "./precondition.ts";
import type { PreconditionResult } from "./precondition.ts";
import { recordCommitted } from "./record.ts";
import { resolvePath } from "./resolve.ts";
import { MutationScope } from "./scope.ts";
import type { Target } from "./target.ts";
import { statAgain, statTarget } from "./target.ts";

interface Slot {
  readonly op: PatchOperation;
  readonly main: Target;
  readonly dest: Target | null;
}

export async function runApplyPatch<THost>(
  deps: ApplyPatchDependencies<THost>,
  input: unknown,
  call: ToolCallContext<THost>,
): Promise<MutationResult> {
  let request: ApplyPatchRequest;
  try {
    request = parseApplyPatchInput(input, deps.limits);
  } catch (error) {
    return formatResult(deps, call, invalidInput(deps, "apply_patch", input, error));
  }
  const scope = new MutationScope(deps, request, call);
  let report: MutationReport;
  try {
    report = await patchStages(scope, deps, request);
  } catch (error) {
    const failed = stopped(scope, error);
    report = { ...failed, notes: [...failed.notes, ...scope.notes] };
  }
  return formatResult(deps, call, report);
}

async function patchStages<THost>(
  scope: MutationScope<THost>,
  deps: ApplyPatchDependencies<THost>,
  request: ApplyPatchRequest,
): Promise<MutationReport> {
  const operations = parsePatchText(scope, deps.patchParser, request.patch);
  scope.checkAbort();
  scope.enter("resolve");
  const fs = scope.fileSystem();
  const slots: Slot[] = [];
  for (const op of operations) {
    const main = { requestedPath: op.path, path: await resolvePath(scope, fs, op.path) };
    const moveTo = op.kind === "update" ? op.moveTo : null;
    const dest =
      moveTo === null
        ? null
        : { requestedPath: moveTo, path: await resolvePath(scope, fs, moveTo) };
    slots.push({ op, main, dest });
  }
  const targets = slots.flatMap((slot) =>
    slot.dest === null ? [slot.main] : [slot.main, slot.dest],
  );
  const first = new Map<Target, FileStat>();
  for (const target of targets) first.set(target, await statTarget(scope, fs, target));
  const early = earlyProblems(scope, fs, slots, first);
  if (early.length > 0) throw verifyFailure(scope, early);
  await authorizeAccess(scope, accessRequests(slots, first));

  const keys = targets.map((target) => (first.get(target) as FileStat).resolvedPath);
  const release = await acquireLocks(
    scope,
    keys,
    targets.map((target) => target.requestedPath),
  );
  try {
    const stats = new Map<Target, FileStat>();
    for (const target of targets) {
      stats.set(target, await statAgain(scope, fs, target, first.get(target) as FileStat));
    }
    const problems = existenceProblems(scope, slots, stats);
    const loaded = await loadAll(scope, fs, slots, stats);
    const { changes, unchanged } = planPatch(scope, deps.matchers, loaded, problems);
    if (changes.length === 0) return noChange(scope, ...unchanged);

    const planned = changes.map((change) => change.planned.change);
    await runGuards(scope, planned);
    await authorizeChanges(scope, planned);
    const steps = encodeSteps(scope, changes);
    if (steps.length === 0) return noChange(scope, ...unchanged, ...changes.map(displayOf));
    const published = await commitPatch(scope, fs, steps, patchFiles(slots, stats));

    const committed: Committed[] = published.map(({ step, file }) => {
      const { planned: plannedStep, source } = step.change;
      if (file === null) {
        const change = deleteChange(plannedStep, plannedStep.target);
        return {
          planned: plannedStep,
          change,
          identity: null,
          finalStateKnown: true,
          rewrittenByHook: false,
        };
      }
      const base = fileChange(scope, plannedStep, step.bytes as Uint8Array, file);
      const change = source === null ? base : { ...base, movedFrom: source.displayPath };
      return committedFile(scope, plannedStep, change, file);
    });
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

function earlyProblems<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  slots: readonly Slot[],
  first: ReadonlyMap<Target, FileStat>,
): PatchProblem[] {
  const problems = duplicateTargetProblems(scope, slots, first);
  if (typeof fs.remove === "function") return problems;
  return [...problems, ...removeUnsupportedProblems(scope, slots)];
}

function duplicateTargetProblems<THost>(
  scope: MutationScope<THost>,
  slots: readonly Slot[],
  first: ReadonlyMap<Target, FileStat>,
): PatchProblem[] {
  const { messages } = scope.deps;
  const problems: PatchProblem[] = [];
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const { op, main, dest } of slots) {
    for (const target of dest === null ? [main] : [main, dest]) {
      const key = (first.get(target) as FileStat).resolvedPath;
      if (!seen.has(key)) {
        seen.add(key);
        continue;
      }
      if (reported.has(key)) continue;
      reported.add(key);
      const path = target.requestedPath;
      const message = messages.patchDuplicateTarget({ path });
      problems.push({ path, line: op.line, reason: "duplicate", message });
    }
  }
  return problems;
}

function removeUnsupportedProblems<THost>(
  scope: MutationScope<THost>,
  slots: readonly Slot[],
): PatchProblem[] {
  const { messages } = scope.deps;
  const problems: PatchProblem[] = [];
  for (const { op, dest } of slots) {
    if (op.kind !== "delete" && dest === null) continue;
    const path = op.path;
    const detail = "the backend cannot remove files";
    const message = messages.unsupportedBackend({ path, detail });
    problems.push({ path, line: op.line, reason: "unsupported", message });
  }
  return problems;
}

function accessRequests(
  slots: readonly Slot[],
  first: ReadonlyMap<Target, FileStat>,
): AccessRequest[] {
  const requests: AccessRequest[] = [];
  for (const { op, main, dest } of slots) {
    const target = resolvedOf(main, first);
    if (op.kind === "add") requests.push({ action: "create", target });
    else if (op.kind === "delete") requests.push({ action: "delete", target });
    else if (dest === null) requests.push({ action: "update", target });
    else {
      requests.push({ action: "move", target });
      requests.push({ action: "create", target: resolvedOf(dest, first) });
    }
  }
  return requests;
}

function existenceProblems<THost>(
  scope: MutationScope<THost>,
  slots: readonly Slot[],
  stats: ReadonlyMap<Target, FileStat>,
): PatchProblem[] {
  const { messages } = scope.deps;
  const problems: PatchProblem[] = [];
  for (const { op, main, dest } of slots) {
    const exists = (stats.get(main) as FileStat).exists;
    const path = main.requestedPath;
    if (op.kind === "add" && exists) {
      problems.push({
        path,
        line: op.line,
        reason: "exists",
        message: messages.exists({ tool: "apply_patch", path }),
      });
    }
    if (op.kind !== "add" && !exists) {
      problems.push({
        path,
        line: op.line,
        reason: "not-found",
        message: messages.patchNotFound({ path, operation: op.kind }),
      });
    }
    if (dest !== null && (stats.get(dest) as FileStat).exists) {
      const to = dest.requestedPath;
      problems.push({
        path: to,
        line: op.line,
        reason: "move-exists",
        message: messages.patchMoveExists({ path: to, from: path }),
      });
    }
  }
  return problems;
}

async function loadAll<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  slots: readonly Slot[],
  stats: ReadonlyMap<Target, FileStat>,
): Promise<PatchTarget[]> {
  const targets: PatchTarget[] = [];
  const failures: { readonly path: string; readonly stop: WriteStop }[] = [];
  for (const { op, main, dest } of slots) {
    const stat = stats.get(main) as FileStat;
    let loaded: Loaded | null = null;
    let pre: PreconditionResult | null = null;
    if (stat.exists && op.kind !== "add")
      loaded = await loadFile(scope, fs, stat, main.requestedPath);
    if (loaded !== null || (op.kind === "add" && !stat.exists)) {
      try {
        pre = await checkPrecondition(scope, fs, stat, loaded, main.requestedPath);
      } catch (error) {
        const code = error instanceof WriteStop ? error.report.error.code : null;
        if (code !== "NOT_READ" && code !== "STALE") throw error;
        failures.push({ path: main.requestedPath, stop: error as WriteStop });
      }
    }
    const destination = dest === null ? null : resolvedOf(dest, stats);
    targets.push({ op, main: resolvedOf(main, stats), dest: destination, loaded, pre });
  }
  if (failures.length > 0) throw preconditionFailure(scope, failures);
  return targets;
}

function preconditionFailure<THost>(
  scope: MutationScope<THost>,
  failures: readonly { readonly path: string; readonly stop: WriteStop }[],
): WriteStop {
  const [first] = failures;
  if (first === undefined || failures.length === 1) return (first as (typeof failures)[0]).stop;
  const code = first.stop.report.error.code;
  const message = failures.map(({ stop }) => stop.report.error.message).join("\n");
  const listed = failures.map(({ path, stop }) => ({
    path,
    code: stop.report.error.code,
    ...stop.report.error.data,
  }));
  scope.enter("precondition");
  return scope.stop(code, message, { failures: listed });
}

function encodeSteps<THost>(
  scope: MutationScope<THost>,
  changes: readonly PatchChange[],
): PatchStep[] {
  const encoded: { readonly change: PatchChange; readonly bytes: Uint8Array | null }[] = [];
  for (const change of changes) {
    const { planned, source } = change;
    if (planned.change.kind === "delete") {
      encoded.push({ change, bytes: null });
      continue;
    }
    const bytes = encodePlanned(scope, planned);
    if (bytes !== "same") encoded.push({ change, bytes });
    else if (source !== null) encoded.push({ change, bytes: (planned.loaded as Loaded).bytes });
  }
  scope.enter("commit");
  return encoded.map(({ change, bytes }): PatchStep => {
    const { planned, source } = change;
    if (planned.precondition.kind !== "absent") return { change, bytes, mode: null };
    const asked = newFileMode(scope, planned.change);
    const mode = asked ?? (source === null ? null : (planned.loaded?.mode ?? null));
    return { change, bytes, mode };
  });
}

function patchFiles(slots: readonly Slot[], stats: ReadonlyMap<Target, FileStat>): PatchFile[] {
  return slots.flatMap(({ main, dest }) =>
    (dest === null ? [main] : [main, dest]).map((target) => {
      const stat = stats.get(target) as FileStat;
      return { path: stat.displayPath, resolvedPath: stat.resolvedPath };
    }),
  );
}

function displayOf(change: PatchChange): string {
  return change.planned.target.displayPath;
}

function resolvedOf(target: Target, stats: ReadonlyMap<Target, FileStat>): ResolvedTarget {
  const stat = stats.get(target) as FileStat;
  return {
    requestedPath: target.requestedPath,
    resolvedPath: stat.resolvedPath,
    displayPath: stat.displayPath,
  };
}
