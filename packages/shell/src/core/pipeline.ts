import type { ContentPart, Note, ToolCallContext } from "@better-fs-tools/read";

import type { ShellDependencies } from "../contract/deps.ts";
import type { RunOutcome, ShellHookContext } from "../contract/extensions.ts";
import type { BashRequest } from "../contract/input.ts";
import type {
  ShellError,
  ShellFailure,
  ShellOutput,
  ShellReport,
  ShellResult,
  ShellRun,
  ShellRunReport,
} from "../contract/result.ts";
import { defaultShellFormatter } from "../formatters/default.ts";
import { AbortStop } from "./abort.ts";
import { execute } from "./execute.ts";
import type { Executed } from "./execute.ts";
import { clampedTimeout, isRecord, parseBashInput } from "./input.ts";
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
import { StageStop, errorNote, extensionId, info, isNoteList, messageOf, warning } from "./stop.ts";

export async function runBash<THost>(
  deps: ShellDependencies<THost>,
  input: unknown,
  call: ToolCallContext<THost>,
): Promise<ShellResult> {
  const notes: Note[] = [];
  const { messages, limits } = deps;

  let request: BashRequest;
  try {
    request = parseBashInput(input, limits);
  } catch (error) {
    const note = errorNote("INVALID_INPUT", messages.invalidInput({ detail: messageOf(error) }));
    return finish(
      deps,
      call,
      failedBeforeStart(null, new StageStop("INVALID_INPUT", "input", note), notes),
    );
  }
  const requested = clampedTimeout(input, request);
  if (requested !== null) {
    const max = limits.maxTimeoutMs;
    const message = messages.timeoutClamped({ requestedMs: requested, maxMs: max });
    notes.push(info("clamped", message, { param: "timeoutMs", requested, max }));
  }

  const ctx: ShellHookContext<THost> = {
    tool: "bash",
    request,
    limits,
    messages,
    digest: deps.digest,
    clock: deps.clock,
    call,
  };
  const scope: CallScope<THost> = { deps, call, notes, ctx };
  // A function, so TypeScript does not narrow the check away after an await.
  const aborted = () => call.signal?.aborted === true;

  try {
    if (aborted()) throw new AbortStop("input");
    const runner = runnerFor(deps, call);
    const base = baseCwd(deps, call, runner);
    const cwd = await resolveCwd(scope, base, request.cwd);
    const run = await beforeRun(scope, {
      command: request.command,
      cwd,
      timeoutMs: request.timeoutMs,
    });
    await authorize(scope, run, base);
    const env = await environment(scope, run);
    if (aborted()) throw new AbortStop("run");
    const executed = await execute(scope, runner, run, env);
    return finish(deps, call, await afterRun(scope, executed));
  } catch (error) {
    if (error instanceof AbortStop) {
      const note = errorNote("ABORTED", messages.abortedBeforeStart());
      return finish(
        deps,
        call,
        failedBeforeStart(request, new StageStop("ABORTED", error.phase, note), notes),
      );
    }
    if (error instanceof StageStop)
      return finish(deps, call, failedBeforeStart(request, error, notes));
    throw error;
  }
}

function statusOf(run: ShellRun): ShellRunReport["status"] {
  if (run.stoppedBy === "timeout") return "timeout";
  return run.exitCode === 0 ? "ok" : "failed";
}

async function afterRun<THost>(scope: CallScope<THost>, executed: Executed): Promise<ShellReport> {
  const { run, stop } = executed;
  const request = scope.ctx.request;
  const error = stop === null ? null : errorOf(stop);
  let output = executed.output;
  let notes: readonly Note[] = stop === null ? [...scope.notes] : [stop.note, ...scope.notes];
  const outcome = (): RunOutcome =>
    error === null
      ? { status: statusOf(run), run, output, notes }
      : { status: "error", error, run, output, notes };

  for (const hook of scope.deps.afterRun) {
    let next: unknown;
    try {
      next = await hook.afterRun(outcome(), scope.ctx);
    } catch {
      return failedHook(scope, run, output, notes, hook);
    }
    if (!isRecord(next)) return failedHook(scope, run, output, notes, hook);
    const nextOutput = next.output ?? output;
    const nextNotes = next.notes ?? notes;
    if (!isOutput(nextOutput) || !isNoteList(nextNotes)) {
      return failedHook(scope, run, output, notes, hook);
    }
    output = nextOutput;
    notes = nextNotes;
  }
  return error === null
    ? ranReport(request, statusOf(run), run, output, notes)
    : failureReport(request, error, run, output, notes);
}

function failedHook<THost>(
  scope: CallScope<THost>,
  run: ShellRun,
  output: ShellOutput,
  notes: readonly Note[],
  hook: unknown,
): ShellReport {
  const failure = extensionFailure(scope, hook, "afterRun");
  return failureReport(scope.ctx.request, errorOf(failure), run, output, [failure.note, ...notes]);
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

function errorOf(stop: StageStop): ShellError {
  const { note } = stop;
  return {
    code: stop.code,
    phase: stop.phase,
    message: note.message,
    ...(note.data === undefined ? {} : { data: note.data }),
  };
}

function failedBeforeStart(
  request: BashRequest | null,
  stop: StageStop,
  notes: readonly Note[],
): ShellFailure {
  return failureReport(request, errorOf(stop), null, null, [stop.note, ...notes]);
}

function ranReport(
  request: BashRequest,
  status: ShellRunReport["status"],
  run: ShellRun,
  output: ShellOutput,
  notes: readonly Note[],
): ShellRunReport {
  return Object.freeze({
    tool: "bash",
    status,
    request,
    run,
    output,
    notes: Object.freeze([...notes]),
  });
}

function failureReport(
  request: BashRequest | null,
  error: ShellError,
  run: ShellRun | null,
  output: ShellOutput | null,
  notes: readonly Note[],
): ShellFailure {
  return Object.freeze({
    tool: "bash",
    status: "error",
    error,
    request,
    run,
    output,
    notes: Object.freeze([...notes]),
  });
}

function finish<THost>(
  deps: ShellDependencies<THost>,
  call: ToolCallContext<THost>,
  done: ShellReport,
): ShellResult {
  const context = {
    digest: deps.digest,
    limits: deps.limits,
    messages: deps.messages,
    mode: "model" as const,
    call,
  };
  let content: readonly ContentPart[] | null = null;
  try {
    content = toContent(deps.formatter.format(done, context));
  } catch {}
  if (content !== null) return Object.freeze({ ...done, content });
  const id = extensionId(deps.formatter);
  const note = warning(
    "extension-failed",
    deps.messages.extensionFailed({ extension: id, phase: "format" }),
    { extension: "formatter", id },
  );
  const kept: ShellReport = Object.freeze({
    ...done,
    notes: Object.freeze([...done.notes, note]),
  });
  return Object.freeze({
    ...kept,
    content: toContent(defaultShellFormatter().format(kept, context)) ?? [],
  });
}

function toContent(value: unknown): readonly ContentPart[] | null {
  if (typeof value === "string") return Object.freeze([{ type: "text", text: value }]);
  if (Array.isArray(value)) return Object.freeze([...(value as ContentPart[])]);
  return null;
}
