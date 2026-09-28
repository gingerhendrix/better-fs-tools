import { posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type { Note, ToolCallContext, ToolResolveContext } from "@better-fs-tools/read";

import type { ShellDependencies } from "../contract/deps.ts";
import type { PlannedRun, ShellAuthorizeTarget, ShellHookContext } from "../contract/extensions.ts";
import type { ShellPhase } from "../contract/result.ts";
import type { CommandRunner } from "../contract/runner.ts";
import { AbortStop, raceAbort } from "./abort.ts";
import { isAbsolute, isRunner } from "./deps.ts";
import { isRecord } from "./input.ts";
import { StageStop, extensionId, isNote, isNoteList, warning } from "./stop.ts";

/** One call's dependencies, notes, and hook context. */
export interface CallScope<THost> {
  readonly deps: ShellDependencies<THost>;
  readonly call: ToolCallContext<THost>;
  readonly notes: Note[];
  readonly ctx: ShellHookContext<THost>;
}

export function extensionFailure<THost>(
  scope: Pick<CallScope<THost>, "deps">,
  extension: unknown,
  phase: ShellPhase,
): StageStop {
  const message = scope.deps.messages.extensionFailed({ extension: extensionId(extension), phase });
  return new StageStop("error", "EXTENSION_FAILED", phase, warning("EXTENSION_FAILED", message));
}

/** Runs host code under the caller's signal. A throw becomes EXTENSION_FAILED for `phase`. */
async function hostCall<THost, T>(
  scope: CallScope<THost>,
  extension: unknown,
  phase: ShellPhase,
  start: () => T | Promise<T>,
): Promise<T> {
  try {
    return await raceAbort(start, scope.call.signal);
  } catch (error) {
    if (error instanceof AbortStop) throw error;
    throw extensionFailure(scope, extension, phase);
  }
}

/** The runner for this call. A factory that throws or returns a non-runner gives EXTENSION_FAILED. */
export function runnerFor<THost>(
  deps: ShellDependencies<THost>,
  call: ToolCallContext<THost>,
): CommandRunner {
  const { runner } = deps;
  if (typeof runner !== "function") return runner;
  let made: unknown;
  try {
    made = runner(call);
  } catch {
    throw extensionFailure({ deps }, { id: "runner" }, "run");
  }
  if (!isRunner(made)) throw extensionFailure({ deps }, { id: "runner" }, "run");
  return made;
}

/** The default cwd for this call: the dependency, or the runner's cwd. */
export function baseCwd<THost>(
  deps: ShellDependencies<THost>,
  call: ToolCallContext<THost>,
  runner: CommandRunner,
): string {
  const { cwd } = deps;
  if (cwd === null) return runner.cwd;
  if (typeof cwd === "string") return cwd;
  let made: unknown;
  try {
    made = cwd(call);
  } catch {
    throw extensionFailure({ deps }, { id: "cwd" }, "resolve");
  }
  if (!isAbsolute(made)) throw extensionFailure({ deps }, { id: "cwd" }, "resolve");
  return made;
}

/**
 * The resolver changes the requested cwd string, then the core resolves it
 * against the default cwd. The resolver gets no listing: the bash tool has
 * no filesystem. A not-found outcome gives CWD_NOT_FOUND.
 */
export async function resolveCwd<THost>(
  scope: CallScope<THost>,
  base: string,
  requested: string | null,
): Promise<string> {
  if (requested === null) return base;
  const resolver = scope.deps.resolve;
  if (resolver === null) return resolvePosix(base, requested);
  const ctx: ToolResolveContext<THost> = {
    ...scope.ctx,
    paths: posixPaths,
    list: async () => ({
      ok: false,
      error: { reason: "unsupported", detail: "the bash tool cannot list" },
    }),
  };
  const outcome: unknown = await hostCall(scope, resolver, "resolve", () =>
    resolver.resolve(requested, ctx),
  );
  const malformed = () => extensionFailure(scope, resolver, "resolve");
  if (!isRecord(outcome)) throw malformed();
  const { note } = outcome;
  if (note !== undefined && !isNote(note)) throw malformed();
  if (note !== undefined) scope.notes.push(note);
  if (outcome.kind === "not-found") {
    const message = scope.deps.messages.cwdNotFound({ cwd: requested });
    throw new StageStop("error", "CWD_NOT_FOUND", "resolve", warning("CWD_NOT_FOUND", message));
  }
  const { path } = outcome;
  if (outcome.kind !== "path" || typeof path !== "string" || path.trim() === "") throw malformed();
  return resolvePosix(base, path);
}

export async function authorize<THost>(scope: CallScope<THost>, run: PlannedRun): Promise<void> {
  const authorizer = scope.deps.authorize;
  if (authorizer === null) return;
  const target: ShellAuthorizeTarget = {
    action: "run",
    requestedPath: scope.ctx.request.cwd ?? ".",
    resolvedPath: run.cwd,
    displayPath: run.cwd,
    command: run.command,
    cwd: run.cwd,
    timeoutMs: run.timeoutMs,
  };
  const decision: unknown = await hostCall(scope, authorizer, "authorize", () =>
    authorizer.authorize(target, scope.ctx),
  );
  const malformed = () => extensionFailure(scope, authorizer, "authorize");
  if (!isRecord(decision)) throw malformed();
  if (decision.allow === true) {
    if (decision.notes !== undefined && !isNoteList(decision.notes)) throw malformed();
    scope.notes.push(...(decision.notes ?? []));
    return;
  }
  if (decision.allow !== false) throw malformed();
  if (decision.note !== undefined && !isNote(decision.note)) throw malformed();
  const note =
    decision.note ?? warning("DENIED", scope.deps.messages.denied({ path: run.cwd, detail: null }));
  throw new StageStop("refused", "DENIED", "authorize", note);
}

/** Runs each hook in order. A rewrite feeds the next hook. Returns the run to start. */
export async function beforeRun<THost>(
  scope: CallScope<THost>,
  planned: PlannedRun,
): Promise<PlannedRun> {
  let run = planned;
  for (const hook of scope.deps.beforeRun) {
    const current = run;
    const decision: unknown = await hostCall(scope, hook, "beforeRun", () =>
      hook.beforeRun(current, scope.ctx),
    );
    const malformed = () => extensionFailure(scope, hook, "beforeRun");
    if (!isRecord(decision)) throw malformed();
    if (decision.kind === "refuse") {
      if (!isNote(decision.note)) throw malformed();
      throw new StageStop("refused", "REFUSED", "beforeRun", decision.note);
    }
    if (decision.kind !== "continue") throw malformed();
    const { command, notes } = decision;
    if (notes !== undefined && !isNoteList(notes)) throw malformed();
    if (command !== undefined) {
      if (typeof command !== "string" || command.trim() === "" || command.includes("\u0000")) {
        throw malformed();
      }
      run = { ...run, command };
    }
    scope.notes.push(...(notes ?? []));
  }
  return run;
}

export async function environment<THost>(
  scope: CallScope<THost>,
  run: PlannedRun,
): Promise<Readonly<Record<string, string>>> {
  const { env } = scope.deps;
  const made: unknown = await hostCall(scope, { id: "env" }, "env", () => env(run, scope.ctx));
  if (!isRecord(made) || !Object.values(made).every((value) => typeof value === "string")) {
    throw extensionFailure(scope, { id: "env" }, "env");
  }
  return made as Readonly<Record<string, string>>;
}
