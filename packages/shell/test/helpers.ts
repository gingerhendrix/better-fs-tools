import type {
  CommandRunner,
  OutputChunk,
  RunExit,
  RunRequest,
  ShellResult,
} from "@better-fs-tools/shell";

export type Step = OutputChunk | { readonly delay: number };

export interface Script {
  readonly steps?: readonly Step[];
  /** Default { code: 0, signal: null }. */
  readonly exit?: RunExit;
  /** Never exit by itself. Only a stop ends the run. */
  readonly hang?: boolean;
  /** Ignore the stop signal, so the exit never settles after a stop. */
  readonly ignoreStop?: boolean;
}

export interface ScriptedRunner extends CommandRunner {
  readonly requests: RunRequest[];
}

const encoder = new TextEncoder();

export function out(text: string): OutputChunk {
  return { stream: "stdout", bytes: encoder.encode(text) };
}

export function err(text: string): OutputChunk {
  return { stream: "stderr", bytes: encoder.encode(text) };
}

/** A runner that plays a script: chunks and delays, then an exit. It honours the stop signal. */
export function scriptedRunner(script: Script = {}, cwd = "/work"): ScriptedRunner {
  const requests: RunRequest[] = [];
  return {
    id: "scripted",
    cwd,
    requests,
    run(request) {
      requests.push(request);
      const queue: OutputChunk[] = [];
      let ended = false;
      let wake: (() => void) | undefined;
      const notify = () => {
        wake?.();
        wake = undefined;
      };
      let resolveExit: (exit: RunExit) => void = () => undefined;
      const exit = new Promise<RunExit>((resolve) => {
        resolveExit = resolve;
      });
      const finish = (value: RunExit) => {
        ended = true;
        notify();
        resolveExit(value);
      };
      request.signal.addEventListener("abort", () => {
        if (script.ignoreStop === true) return;
        finish({ code: null, signal: "SIGTERM" });
      });

      void (async () => {
        for (const step of script.steps ?? []) {
          if (ended || request.signal.aborted) return;
          if ("delay" in step) {
            await new Promise((resolve) => setTimeout(resolve, step.delay));
            continue;
          }
          queue.push(step);
          notify();
          await Promise.resolve();
        }
        if (script.hang === true || request.signal.aborted) return;
        finish(script.exit ?? { code: 0, signal: null });
      })();

      const output: AsyncIterable<OutputChunk> = {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<OutputChunk>> {
              for (;;) {
                const chunk = queue.shift();
                if (chunk !== undefined) return { done: false, value: chunk };
                if (ended) return { done: true, value: undefined };
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
              }
            },
            async return(): Promise<IteratorResult<OutputChunk>> {
              ended = true;
              notify();
              return { done: true, value: undefined };
            },
          };
        },
      };
      return { output, exit };
    },
  };
}

export function text(result: ShellResult): string {
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function lines(count: number, prefix = "line"): string {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}\n`).join("");
}

/** The error of a result, or null when its status is not "error". */
export function errorOf<T extends { readonly status: string }>(
  result: T,
): (T extends { readonly status: "error"; readonly error: infer E } ? E : never) | null {
  return result.status === "error" ? (result as unknown as { readonly error: never }).error : null;
}
