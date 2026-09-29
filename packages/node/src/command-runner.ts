import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

import type {
  CommandRunner,
  OutputChunk,
  RunExit,
  RunHandle,
  RunRequest,
} from "@better-fs-tools/shell";

const BACKGROUND_CHILD_PIPE_GRACE_MS = 100;

export interface NodeCommandRunnerOptions {
  /** Default process.cwd(). A relative path resolves against process.cwd(). */
  readonly cwd?: string;
  /** The shell, run as `<shell> -c <command>`. Default "bash". */
  readonly shell?: string;
  /** Default "node". */
  readonly id?: string;
}

/**
 * A command runner that runs `bash -c <command>` on the local machine, with
 * stdin closed. Stopping a command sends SIGTERM to its process group, then
 * SIGKILL after killGraceMs. A background child that outlives the shell keeps
 * running, but its output is no longer captured. POSIX only.
 */
export function nodeCommandRunner(options: NodeCommandRunnerOptions = {}): CommandRunner {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("nodeCommandRunner options must be an object");
  }
  const { cwd: given = process.cwd(), shell = "bash", id = "node" } = options;
  if (typeof given !== "string" || given === "" || given.includes("\0")) {
    throw new TypeError("cwd must be a non-empty path without NUL");
  }
  const cwd = path.resolve(given);
  if (typeof shell !== "string" || shell === "") throw new TypeError("shell must be a string");
  if (typeof id !== "string" || id === "") throw new TypeError("id must be a string");
  return Object.freeze<CommandRunner>({
    id,
    cwd,
    run: (request) => runNode(shell, request),
  });
}

function runNode(shell: string, request: RunRequest): RunHandle {
  const queue = new ChunkQueue();
  const exit = start(shell, request, queue);
  return { output: queue, exit };
}

async function start(shell: string, request: RunRequest, queue: ChunkQueue): Promise<RunExit> {
  const problem = await checkCwd(request.cwd);
  if (problem !== null) {
    queue.end();
    return { code: null, signal: null, error: { reason: problem } };
  }
  if (request.signal.aborted) {
    queue.end();
    return { code: null, signal: "SIGTERM" };
  }

  return new Promise<RunExit>((resolve) => {
    const child = spawn(shell, ["-c", request.command], {
      cwd: request.cwd,
      env: { ...request.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const stopTree = () => {
      signalGroup(child.pid, "SIGTERM");
      forceTimer = setTimeout(() => signalGroup(child.pid, "SIGKILL"), request.killGraceMs);
      forceTimer.unref();
    };
    request.signal.addEventListener("abort", stopTree, { once: true });

    let open = 2;
    const closed = () => {
      open -= 1;
      if (open === 0) queue.end();
    };
    for (const [name, stream] of [
      ["stdout", child.stdout],
      ["stderr", child.stderr],
    ] as const) {
      stream.on("data", (bytes: Buffer) => queue.push({ stream: name, bytes }));
      stream.on("close", closed);
      stream.on("error", () => undefined);
    }

    const finish = (value: RunExit) => {
      if (settled) return;
      settled = true;
      request.signal.removeEventListener("abort", stopTree);
      const releasePipesHeldByBackgroundChild = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        queue.end();
      }, BACKGROUND_CHILD_PIPE_GRACE_MS);
      releasePipesHeldByBackgroundChild.unref();
      // A stopped tree still gets its SIGKILL: grandchildren may outlive the shell.
      if (!request.signal.aborted) clearTimeout(forceTimer);
      resolve(value);
    };
    child.on("error", (error) => {
      queue.end();
      finish({
        code: null,
        signal: null,
        error: { reason: "spawn-failed", detail: error.message },
      });
    });
    child.on("exit", (code, signal) => finish({ code, signal }));
  });
}

async function checkCwd(cwd: string): Promise<"cwd-not-found" | "cwd-not-a-directory" | null> {
  try {
    return (await stat(cwd)).isDirectory() ? null : "cwd-not-a-directory";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return code === "ENOTDIR" ? "cwd-not-a-directory" : "cwd-not-found";
  }
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: the group is gone.
  }
}

class ChunkQueue implements AsyncIterable<OutputChunk> {
  #items: OutputChunk[] = [];
  #ended = false;
  #wake: (() => void) | undefined;

  push(chunk: OutputChunk): void {
    if (this.#ended) return;
    this.#items.push(chunk);
    this.#notify();
  }

  end(): void {
    this.#ended = true;
    this.#notify();
  }

  #notify(): void {
    this.#wake?.();
    this.#wake = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<OutputChunk> {
    return {
      next: async () => {
        for (;;) {
          const item = this.#items.shift();
          if (item !== undefined) return { done: false, value: item };
          if (this.#ended) return { done: true, value: undefined };
          await new Promise<void>((resolve) => {
            this.#wake = resolve;
          });
        }
      },
      return: async () => {
        this.#items = [];
        this.end();
        return { done: true, value: undefined };
      },
    };
  }
}
