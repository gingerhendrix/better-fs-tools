import { containsPosix, posixPaths, resolvePosix } from "@better-fs-tools/fs";
import type { Note, ToolCallContext, ToolResolveContext } from "@better-fs-tools/read";

import type { ShellDependencies } from "../contract/deps.ts";
import type { PlannedRun, ShellAuthorizeTarget, ShellHookContext } from "../contract/extensions.ts";
import type { ShellPhase } from "../contract/result.ts";
import type { CommandRunner } from "../contract/runner.ts";
import { AbortStop, raceAbort } from "./abort.ts";
import { isAbsolute, isRunner } from "./deps.ts";
import { isRecord } from "./input.ts";
import { StageStop, errorNote, extensionId, hostErrorNote, isNote, isNoteList } from "./stop.ts";

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
  return new StageStop("EXTENSION_FAILED", phase, errorNote("EXTENSION_FAILED", message));
}

async function hostCall<THost, T>(
  scope: CallScope<THost>,
  extension: unknown,
  phase: ShellPhase,
  start: () => T | Promise<T>,
): Promise<T> {
  try {
    return await raceAbort(start, scope.call.signal);
  } catch (error) {
    if (error instanceof AbortStop) throw new AbortStop(phase);
    throw extensionFailure(scope, extension, phase);
  }
}

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
    throw new StageStop("CWD_NOT_FOUND", "resolve", errorNote("CWD_NOT_FOUND", message));
  }
  const { path } = outcome;
  if (outcome.kind !== "path" || typeof path !== "string" || path.trim() === "") throw malformed();
  return resolvePosix(base, path);
}

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
    if (decision.allow === false) {
      if (decision.note !== undefined && !isNote(decision.note)) throw malformed();
      const note =
        decision.note === undefined
          ? errorNote("REFUSED", scope.deps.messages.refused({ hook: hook.id }))
          : hostErrorNote("REFUSED", decision.note);
      throw new StageStop("REFUSED", "beforeRun", note);
    }
    if (decision.allow !== true) throw malformed();
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

export async function authorize<THost>(
  scope: CallScope<THost>,
  run: PlannedRun,
  base: string,
): Promise<void> {
  const authorizer = scope.deps.authorize;
  if (authorizer === null) return;
  const target: ShellAuthorizeTarget = {
    action: "run",
    requestedPath: scope.ctx.request.cwd ?? ".",
    resolvedPath: run.cwd,
    displayPath: relativePosix(base, run.cwd),
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
    decision.note === undefined
      ? errorNote("DENIED", scope.deps.messages.denied({ path: run.cwd, detail: null }))
      : hostErrorNote("DENIED", decision.note);
  throw new StageStop("DENIED", "authorize", note);
}

export function relativePosix(base: string, path: string): string {
  if (path === base) return ".";
  if (containsPosix(base, path)) return path.slice(base === "/" ? 1 : base.length + 1);
  const from = base.split("/").filter(Boolean);
  const to = path.split("/").filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  return [...from.slice(shared).map(() => ".."), ...to.slice(shared)].join("/");
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
