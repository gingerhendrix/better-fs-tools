import type { Bash } from "just-bash";

import type {
  CommandRunner,
  OutputChunk,
  RunExit,
  RunHandle,
  RunRequest,
} from "@better-fs-tools/shell";

/** The part of just-bash's Bash class this runner uses. */
export type JustBashShell = Pick<Bash, "exec" | "getCwd" | "fs">;

export interface JustBashCommandRunnerOptions {
  /** Default "just-bash (emulated)". The bash tool description shows it. */
  readonly id?: string;
  /** Default bash.getCwd() when the runner is made. */
  readonly cwd?: string;
}

/**
 * Runs each command with bash.exec() in an emulated shell, without starting a
 * process. stdin is empty, the environment replaces the shell's own, and the
 * cwd applies to the call only. Output arrives after the command ends, stdout
 * before stderr. A stop takes effect at the next statement, and no timeout
 * fires during a busy loop, so set just-bash's executionLimits to bound loops.
 */
export function justBashCommandRunner(
  bash: JustBashShell,
  options: JustBashCommandRunnerOptions = {},
): CommandRunner {
  if (bash === null || typeof bash !== "object" || typeof bash.exec !== "function") {
    throw new TypeError("justBashCommandRunner needs a just-bash Bash instance");
  }
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("justBashCommandRunner options must be an object");
  }
  const { id = "just-bash (emulated)", cwd = bash.getCwd() } = options;
  if (typeof id !== "string" || id === "") throw new TypeError("id must be a non-empty string");
  if (typeof cwd !== "string" || !cwd.startsWith("/")) {
    throw new TypeError("cwd must be an absolute path: just-bash has no process cwd");
  }
  return Object.freeze<CommandRunner>({ id, cwd, run: (request) => run(bash, request) });
}

function run(bash: JustBashShell, request: RunRequest): RunHandle {
  const chunks: OutputChunk[] = [];
  const exit = (async (): Promise<RunExit> => {
    const problem = await checkCwd(bash, request.cwd);
    if (problem !== null) return { code: null, signal: null, error: { reason: problem } };
    try {
      const result = await bash.exec(request.command, {
        cwd: request.cwd,
        env: { ...request.env },
        replaceEnv: true,
        stdin: "",
        signal: request.signal,
      });
      const encoder = new TextEncoder();
      if (result.stdout !== "")
        chunks.push({ stream: "stdout", bytes: encoder.encode(result.stdout) });
      if (result.stderr !== "")
        chunks.push({ stream: "stderr", bytes: encoder.encode(result.stderr) });
      if (request.signal.aborted) return { code: null, signal: "SIGTERM" };
      return { code: result.exitCode, signal: null };
    } catch (error) {
      if (request.signal.aborted) return { code: null, signal: "SIGTERM" };
      const detail = error instanceof Error ? error.message : String(error);
      return { code: null, signal: null, error: { reason: "spawn-failed", detail } };
    }
  })();
  const output: AsyncIterable<OutputChunk> = {
    async *[Symbol.asyncIterator]() {
      await exit;
      yield* chunks;
    },
  };
  return { output, exit };
}

async function checkCwd(
  bash: JustBashShell,
  cwd: string,
): Promise<"cwd-not-found" | "cwd-not-a-directory" | null> {
  try {
    return (await bash.fs.stat(cwd)).isDirectory ? null : "cwd-not-a-directory";
  } catch {
    return "cwd-not-found";
  }
}
