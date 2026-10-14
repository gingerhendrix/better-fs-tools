import { withAbortSignal } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

import type {
  CommandRunner,
  OutputChunk,
  RunExit,
  RunHandle,
  RunRequest,
  RunStartError,
} from "@better-fs-tools/shell";

export interface ExecutionEnvRunnerOptions {
  /** The Chord context of the tool call. Cancelling it stops the command too. */
  readonly context: Context;
  /** Default `pi-durable:<env.id>`. The bash tool description shows it. */
  readonly id?: string;
  /** Default env.cwd. */
  readonly cwd?: string;
  /**
   * Default true: a command keeps the environment's own variables, such as
   * PATH and HOME on a remote host, and the request's variables override them.
   * false: the request's variables are the whole environment of the command.
   */
  readonly inheritEnv?: boolean;
}

/**
 * Runs each command with the environment's exec(), through its shell: on the
 * local machine for a NodeExecutionEnv, over SSH for pi-env's
 * RemoteExecutionEnv. Output arrives as the environment reports it, stdout and
 * stderr apart. A stop aborts the exec() call, and the environment kills the
 * command's processes. By default the command also keeps the environment's
 * own variables: see `inheritEnv`.
 */
export function executionEnvRunner(
  env: ExecutionEnv,
  options: ExecutionEnvRunnerOptions,
): CommandRunner {
  if (env === null || typeof env !== "object" || typeof env.exec !== "function") {
    throw new TypeError("executionEnvRunner needs a pi-durable ExecutionEnv");
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("executionEnvRunner options must be an object");
  }
  const { context, id = `pi-durable:${env.id}`, cwd = env.cwd, inheritEnv = true } = options;
  if (context === null || typeof context !== "object" || typeof context.value !== "function") {
    throw new TypeError("executionEnvRunner needs the Chord context of the call");
  }
  if (typeof id !== "string" || id === "") throw new TypeError("id must be a non-empty string");
  if (typeof inheritEnv !== "boolean") throw new TypeError("inheritEnv must be a boolean");
  if (typeof cwd !== "string" || !cwd.startsWith("/")) {
    throw new TypeError("cwd must be an absolute POSIX path");
  }
  return Object.freeze<CommandRunner>({
    id,
    cwd,
    run: (request) => run(env, withAbortSignal(request.signal, context), request, inheritEnv),
  });
}

function run(env: ExecutionEnv, ctx: Context, request: RunRequest, inheritEnv: boolean): RunHandle {
  const output = new ChunkQueue();
  const encoder = new TextEncoder();
  const exit = (async (): Promise<RunExit> => {
    try {
      const problem = await checkCwd(env, request.cwd, ctx);
      if (problem !== null) return { code: null, signal: null, error: problem };
      const result = await env.exec(
        request.command,
        {
          cwd: request.cwd,
          env: { ...request.env },
          inheritEnv,
          onOutput: (text, _context, info) => {
            if (text !== "") output.push({ stream: info.stream, bytes: encoder.encode(text) });
          },
        },
        ctx,
      );
      if (result.ok) return { code: result.value.exitCode, signal: null };
      if (result.error.code === "aborted" || request.signal.aborted) {
        return { code: null, signal: "SIGTERM" };
      }
      if (result.error.code === "timeout") return { code: null, signal: "SIGKILL" };
      return {
        code: null,
        signal: null,
        error: { reason: "spawn-failed", detail: result.error.code },
      };
    } catch (error) {
      if (request.signal.aborted) return { code: null, signal: "SIGTERM" };
      const detail = error instanceof Error ? error.name : "unknown";
      return { code: null, signal: null, error: { reason: "spawn-failed", detail } };
    } finally {
      output.end();
    }
  })();
  return { output, exit };
}

async function checkCwd(
  env: ExecutionEnv,
  cwd: string,
  ctx: Context,
): Promise<RunStartError | null> {
  const info = await env.fileInfo(cwd, ctx);
  if (info.ok) {
    if (info.value.kind === "directory") return null;
    if (info.value.kind === "symlink") {
      // fileInfo does not follow a link: ask the link's target.
      const real = await env.canonicalPath(cwd, ctx);
      if (!real.ok) return { reason: "cwd-not-found" };
      return checkCwd(env, real.value, ctx);
    }
    return { reason: "cwd-not-a-directory" };
  }
  return { reason: "cwd-not-found" };
}

/** Output chunks in arrival order, for one reader. */
class ChunkQueue implements AsyncIterable<OutputChunk> {
  private readonly chunks: OutputChunk[] = [];
  private ended = false;
  private wake: (() => void) | null = null;

  push(chunk: OutputChunk): void {
    if (this.ended) return;
    this.chunks.push(chunk);
    this.notify();
  }

  end(): void {
    this.ended = true;
    this.notify();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<OutputChunk> {
    for (;;) {
      const next = this.chunks.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}
