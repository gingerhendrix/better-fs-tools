import type { ContentPart, Note, ToolCallContext } from "@better-fs-tools/read";

import type { ShellDependencies } from "../contract/deps.ts";
import type { RunOutcome, ShellHookContext } from "../contract/extensions.ts";
import type { BashRequest } from "../contract/input.ts";
import type {
  ShellError,
  ShellOutput,
  ShellReport,
  ShellResult,
  ShellRun,
  ShellStatus,
} from "../contract/result.ts";
import { defaultShellFormatter } from "../formatters/default.ts";
import { AbortStop } from "./abort.ts";
import { execute } from "./execute.ts";
import { InputError, isRecord, parseBashInput } from "./input.ts";
import {
  authorize,
  baseCwd,
  beforeRun,
  environment,
  extensionFailure,
  resolveCwd,
  runnerFor,
} from "./stages.ts";
import type { CallScope } from "./stages.ts";
import { StageStop, info, isNoteList, warning } from "./stop.ts";

/**
 * input → runner and cwd → authorize → beforeRun → env → run and capture →
 * afterRun → format. Every expected failure is a result. Only a formatter
 * that throws twice propagates.
 */
export async function runBash<THost>(
  deps: ShellDependencies<THost>,
  input: unknown,
  call: ToolCallContext<THost>,
): Promise<ShellResult> {
  const notes: Note[] = [];
  const { messages, limits } = deps;

  let request: BashRequest;
  try {
    const parsed = parseBashInput(input, limits);
    request = parsed.request;
    if (parsed.clampedFrom !== null) {
      const message = messages.timeoutClamped({
        requestedMs: parsed.clampedFrom,
        maxMs: limits.maxTimeoutMs,
      });
      notes.push(info("TIMEOUT_CLAMPED", message));
    }
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    const note = warning("INVALID_INPUT", messages.invalidInput({ detail: error.message }));
    return finish(
      deps,
      call,
      stopped(null, new StageStop("error", "INVALID_INPUT", "input", note), notes),
    );
  }

  const ctx: ShellHookContext<THost> = {
    tool: "bash",
    request,
    limits,
    messages,
    digest: null,
    clock: () => new Date(),
    call,
  };
  const scope: CallScope<THost> = { deps, call, notes, ctx };

  try {
    const runner = runnerFor(deps, call);
    const cwd = await resolveCwd(scope, baseCwd(deps, call, runner), request.cwd);
    const planned = { command: request.command, cwd, timeoutMs: request.timeoutMs };
    await authorize(scope, planned);
    const run = await beforeRun(scope, planned);
    const env = await environment(scope, run);
    if (call.signal?.aborted === true) throw new AbortStop();
    const executed = await execute(scope, runner, run, env);
    const outcome = await afterRun(scope, {
      status: statusOf(executed.run),
      run: executed.run,
      output: executed.output,
      notes: [...notes],
    });
    return finish(deps, call, outcome);
  } catch (error) {
    if (error instanceof AbortStop) {
      notes.push(warning("ABORTED", messages.abortedBeforeStart()));
      return finish(deps, call, report(request, "aborted", null, null, null, notes));
    }
    if (error instanceof StageStop) return finish(deps, call, stopped(request, error, notes));
    throw error;
  }
}

function statusOf(run: ShellRun): ShellStatus {
  if (run.stoppedBy === "timeout") return "timeout";
  if (run.stoppedBy === "abort") return "aborted";
  if (run.stoppedBy === "output-cap") return "error";
  return run.exitCode === 0 ? "ok" : "failed";
}

type Pending = RunOutcome & { readonly error?: ShellError; readonly request: BashRequest };

/**
 * Each hook may change the output view and the notes. status and run stay as
 * the core set them. A hook that throws or returns a malformed outcome gives
 * EXTENSION_FAILED with the run and the output so far.
 */
async function afterRun<THost>(scope: CallScope<THost>, first: RunOutcome): Promise<ShellReport> {
  let outcome = first;
  const request = scope.ctx.request;
  const base: Pending =
    first.run.stoppedBy === "output-cap"
      ? { ...first, request, error: { code: "OUTPUT_CAP", phase: "run" } }
      : { ...first, request };
  for (const hook of scope.deps.afterRun) {
    const current = outcome;
    let next: unknown;
    try {
      next = await hook.afterRun(current, scope.ctx);
    } catch {
      return failedHook(scope, base, outcome, hook);
    }
    if (!isRecord(next) || !isOutput(next.output) || !isNoteList(next.notes)) {
      return failedHook(scope, base, outcome, hook);
    }
    outcome = { status: first.status, run: first.run, output: next.output, notes: next.notes };
  }
  return report(request, base.status, base.error ?? null, first.run, outcome.output, outcome.notes);
}

function failedHook<THost>(
  scope: CallScope<THost>,
  base: Pending,
  outcome: RunOutcome,
  hook: unknown,
): ShellReport {
  const failure = extensionFailure(scope, hook, "afterRun");
  return report(
    base.request,
    "error",
    { code: "EXTENSION_FAILED", phase: "afterRun" },
    base.run,
    outcome.output,
    [...outcome.notes, failure.note],
  );
}

function isOutput(value: unknown): value is ShellOutput {
  if (!isRecord(value)) return false;
  const numbers = [
    "totalBytes",
    "totalLines",
    "omittedBytes",
    "omittedLines",
    "stdoutBytes",
    "stderrBytes",
  ];
  return (
    typeof value.head === "string" &&
    (value.tail === null || typeof value.tail === "string") &&
    (value.spill === null || typeof value.spill === "string") &&
    numbers.every((key) => typeof value[key] === "number")
  );
}

function stopped(
  request: BashRequest | null,
  stop: StageStop,
  notes: readonly Note[],
): ShellReport {
  return report(request, stop.status, { code: stop.code, phase: stop.phase }, null, null, [
    ...notes,
    stop.note,
  ]);
}

function report(
  request: BashRequest | null,
  status: ShellStatus,
  error: ShellError | null,
  run: ShellRun | null,
  output: ShellOutput | null,
  notes: readonly Note[],
): ShellReport {
  return Object.freeze({
    tool: "bash",
    status,
    error,
    request,
    run,
    output,
    notes: Object.freeze([...notes]),
  });
}

/**
 * Formats the report. A formatter that throws or returns something else gives
 * EXTENSION_FAILED, formatted by the default formatter.
 */
function finish<THost>(
  deps: ShellDependencies<THost>,
  call: ToolCallContext<THost>,
  done: ShellReport,
): ShellResult {
  const context = { limits: deps.limits, messages: deps.messages, mode: "model" as const, call };
  try {
    const content = toContent(deps.formatter.format(done, context));
    if (content !== null) return Object.freeze({ ...done, content });
  } catch {
    // Falls through to the default formatter.
  }
  const failure = extensionFailure({ deps }, deps.formatter, "format");
  const failed = report(
    done.request,
    "error",
    { code: "EXTENSION_FAILED", phase: "format" },
    done.run,
    done.output,
    [...done.notes, failure.note],
  );
  const content = toContent(defaultShellFormatter().format(failed, context)) ?? [];
  return Object.freeze({ ...failed, content });
}

function toContent(value: unknown): readonly ContentPart[] | null {
  if (typeof value === "string") return Object.freeze([{ type: "text", text: value }]);
  if (Array.isArray(value)) return Object.freeze([...(value as ContentPart[])]);
  return null;
}
