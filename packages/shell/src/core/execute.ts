import type { PlannedRun, SpillWriter } from "../contract/extensions.ts";
import type { ShellOutput, ShellRun } from "../contract/result.ts";
import type {
  CommandRunner,
  OutputChunk,
  RunExit,
  RunHandle,
  RunRequest,
} from "../contract/runner.ts";
import { delay, unref } from "./abort.ts";
import { OutputCapture } from "./capture.ts";
import { isRecord } from "./input.ts";
import type { CallScope } from "./stages.ts";
import { extensionFailure } from "./stages.ts";
import { StageStop, errorNote, messageOf, warning } from "./stop.ts";

const DRAIN_AFTER_EXIT_MS = 1_000;
const EXIT_WAIT_AFTER_KILL_GRACE_MS = 1_000;

type StopReason = NonNullable<ShellRun["stoppedBy"]>;

export interface Executed {
  readonly run: ShellRun;
  readonly output: ShellOutput;
  readonly stop: StageStop | null;
}

export async function execute<THost>(
  scope: CallScope<THost>,
  runner: CommandRunner,
  planned: PlannedRun,
  env: Readonly<Record<string, string>>,
): Promise<Executed> {
  const { limits, messages } = scope.deps;
  const spill = await openSpill(scope, planned);

  const controller = new AbortController();
  let stoppedBy: StopReason | null = null;
  let exited = false;
  const stop = (reason: StopReason) => {
    if (exited || stoppedBy !== null) return;
    stoppedBy = reason;
    controller.abort();
  };
  const { signal } = scope.call;
  const onAbort = () => stop("abort");
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => stop("timeout"), planned.timeoutMs);
  unref(timer);
  const release = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  };

  const started = Date.now();
  let handle: RunHandle;
  try {
    handle = startRun(runner, {
      command: planned.command,
      cwd: planned.cwd,
      env,
      signal: controller.signal,
      killGraceMs: limits.killGraceMs,
    });
  } catch (error) {
    release();
    await spill?.close().catch(() => undefined);
    throw startFailure(scope, messageOf(error));
  }
  if (signal?.aborted) stop("abort");

  const capture = new OutputCapture(limits);
  const iterator = handle.output[Symbol.asyncIterator]();
  let skippedChunks = 0;
  let streamFailed: string | null = null;
  let streamEnded = false;
  let outputReleased = false;
  const drain = (async () => {
    try {
      for (;;) {
        const next = await iterator.next();
        if (outputReleased) return;
        if (next.done === true) {
          streamEnded = true;
          return;
        }
        const chunk = validChunk(next.value);
        if (chunk === null) {
          skippedChunks += 1;
          continue;
        }
        capture.push(chunk);
        spill?.write(chunk.bytes);
        if (capture.totalBytes > limits.maxCaptureBytes) stop("output-cap");
      }
    } catch (error) {
      streamFailed = messageOf(error);
    }
  })();

  const exitPromise = settleExit(handle.exit).then((exit) => {
    exited = true;
    release();
    return exit;
  });
  const exit = await exitOrGiveUpAfterStop(exitPromise, controller.signal, limits.killGraceMs);
  const drainMs = exit === null ? 0 : DRAIN_AFTER_EXIT_MS;
  const drainWait = delay(drainMs);
  await Promise.race([drain, drainWait.done]);
  drainWait.cancel();
  // A background child may still hold the output stream open.
  outputReleased = true;
  void Promise.resolve(iterator.return?.()).catch(() => undefined);
  release();
  const durationMs = Date.now() - started;

  if (exit?.error !== undefined) {
    await spill?.close().catch(() => undefined);
    throw startError(scope, exit.error.reason, exit.error.detail ?? null, planned.cwd);
  }
  const spillRef = await (spill?.close() ?? Promise.resolve(null));
  const reason = stoppedBy as StopReason | null;
  if (exit === null) scope.notes.push(warning("unconfirmed-stop", messages.unconfirmedStop()));
  // After a stop, a runner may end its stream early or with an error.
  const failed = reason === null ? (streamFailed as string | null) : null;
  const unfinished = reason === null && failed === null && !streamEnded ? drainMs : null;
  if (failed !== null || unfinished !== null || skippedChunks > 0) {
    scope.notes.push(
      warning(
        "output-incomplete",
        messages.outputIncomplete({ detail: failed, skippedChunks, drainMs: unfinished }),
        {
          skippedChunks,
          ...(failed === null ? {} : { detail: failed }),
          ...(unfinished === null ? {} : { drainMs: unfinished }),
        },
      ),
    );
  }
  return {
    run: {
      command: planned.command,
      cwd: planned.cwd,
      timeoutMs: planned.timeoutMs,
      exitCode: exit?.code ?? null,
      signal: exit?.signal ?? null,
      durationMs,
      stoppedBy: reason,
      unconfirmedStop: exit === null,
    },
    output: capture.view(limits, spillRef),
    stop: runStop(scope, reason, durationMs),
  };
}

function runStop<THost>(
  scope: CallScope<THost>,
  reason: StopReason | null,
  durationMs: number,
): StageStop | null {
  const { messages, limits } = scope.deps;
  if (reason === "abort") {
    return new StageStop("ABORTED", "run", errorNote("ABORTED", messages.aborted({ durationMs })));
  }
  if (reason === "output-cap") {
    const message = messages.outputCap({ limit: limits.maxCaptureBytes });
    return new StageStop("OUTPUT_CAP", "run", errorNote("OUTPUT_CAP", message));
  }
  return null;
}

function startRun(runner: CommandRunner, request: RunRequest): RunHandle {
  const handle: unknown = runner.run(request);
  if (
    !isRecord(handle) ||
    !isRecord(handle.output) ||
    typeof (handle.output as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !==
      "function" ||
    !isRecord(handle.exit) ||
    typeof handle.exit.then !== "function"
  ) {
    throw new TypeError("the runner returned a malformed handle");
  }
  return handle as unknown as RunHandle;
}

async function exitOrGiveUpAfterStop(
  exit: Promise<RunExit>,
  stopped: AbortSignal,
  killGraceMs: number,
): Promise<RunExit | null> {
  let onStop: (() => void) | undefined;
  let giveUp: ReturnType<typeof delay> | undefined;
  const late = new Promise<null>((resolve) => {
    onStop = () => {
      giveUp = delay(killGraceMs + EXIT_WAIT_AFTER_KILL_GRACE_MS);
      void giveUp.done.then(() => resolve(null));
    };
    if (stopped.aborted) onStop();
    else stopped.addEventListener("abort", onStop, { once: true });
  });
  try {
    return await Promise.race([exit, late]);
  } finally {
    if (onStop !== undefined) stopped.removeEventListener("abort", onStop);
    giveUp?.cancel();
  }
}

async function settleExit(exit: PromiseLike<RunExit>): Promise<RunExit> {
  try {
    const value: unknown = await exit;
    if (!isRecord(value)) throw new TypeError("malformed exit");
    const code = typeof value.code === "number" ? value.code : null;
    const signal = typeof value.signal === "string" ? value.signal : null;
    const { error } = value;
    if (isRecord(error) && typeof error.reason === "string") {
      const reason = error.reason as NonNullable<RunExit["error"]>["reason"];
      const detail = typeof error.detail === "string" ? error.detail : undefined;
      return { code, signal, error: detail === undefined ? { reason } : { reason, detail } };
    }
    return { code, signal };
  } catch (error) {
    return {
      code: null,
      signal: null,
      error: { reason: "spawn-failed", detail: messageOf(error) },
    };
  }
}

function validChunk(value: unknown): OutputChunk | null {
  if (!isRecord(value) || !(value.bytes instanceof Uint8Array)) return null;
  return { stream: value.stream === "stderr" ? "stderr" : "stdout", bytes: value.bytes };
}

function startFailure<THost>(scope: CallScope<THost>, detail: string | null): StageStop {
  const message = scope.deps.messages.spawnFailed({ detail });
  return new StageStop("SPAWN_FAILED", "run", errorNote("SPAWN_FAILED", message));
}

function startError<THost>(
  scope: CallScope<THost>,
  reason: string,
  detail: string | null,
  cwd: string,
): StageStop {
  const { messages } = scope.deps;
  if (reason === "cwd-not-found") {
    const message = messages.cwdNotFound({ cwd });
    return new StageStop("CWD_NOT_FOUND", "run", errorNote("CWD_NOT_FOUND", message));
  }
  if (reason === "cwd-not-a-directory") {
    const message = messages.cwdNotADirectory({ cwd });
    return new StageStop("CWD_NOT_A_DIRECTORY", "run", errorNote("CWD_NOT_A_DIRECTORY", message));
  }
  return startFailure(scope, detail);
}

interface OpenSpill {
  write(bytes: Uint8Array): void;
  close(): Promise<string | null>;
}

async function openSpill<THost>(
  scope: CallScope<THost>,
  planned: PlannedRun,
): Promise<OpenSpill | null> {
  const sink = scope.deps.spill;
  if (sink === null) return null;
  let writer: SpillWriter;
  try {
    writer = await sink.open(planned, scope.ctx);
  } catch {
    throw extensionFailure(scope, sink, "spill");
  }
  if (
    !isRecord(writer) ||
    typeof writer.write !== "function" ||
    typeof writer.close !== "function"
  ) {
    throw extensionFailure(scope, sink, "spill");
  }
  let chain = Promise.resolve();
  let failed = false;
  return {
    write(bytes) {
      if (failed) return;
      const copy = bytes.slice();
      chain = chain.then(async () => {
        if (failed) return;
        try {
          await writer.write(copy);
        } catch {
          failed = true;
        }
      });
    },
    async close() {
      await chain;
      try {
        const ref: unknown = await writer.close();
        if (failed || typeof ref !== "string") {
          failed = true;
          return null;
        }
        return ref;
      } catch {
        failed = true;
        return null;
      }
    },
  };
}
