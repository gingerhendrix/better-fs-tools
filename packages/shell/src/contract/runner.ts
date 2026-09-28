/**
 * The runner is the only required dependency of the bash tool. It starts one
 * command. The core owns the timeout, the abort, and the output budget.
 */
export interface CommandRunner {
  /** Shown in the tool description, for example "node" or "just-bash (emulated)". */
  readonly id: string;
  /** The default working directory. The tool resolves the cwd input against it. */
  readonly cwd: string;
  /**
   * Starts the command. Must not throw for a failed command or a failed
   * start: a start that fails is an exit with `code: null` and an `error`.
   */
  run(request: RunRequest): RunHandle;
}

export interface RunRequest {
  readonly command: string;
  /** Absolute and lexically resolved. The runner checks that it is a directory. */
  readonly cwd: string;
  /** The whole environment of the command. The runner adds nothing to it. */
  readonly env: Readonly<Record<string, string>>;
  /**
   * The core aborts it on a timeout, on the caller's abort, and past the
   * capture cap. The runner must then stop the whole process tree.
   */
  readonly signal: AbortSignal;
  /** After the stop signal, the runner waits this long before it forces the stop (SIGKILL). */
  readonly killGraceMs: number;
}

export interface OutputChunk {
  readonly stream: "stdout" | "stderr";
  readonly bytes: Uint8Array;
}

export interface RunHandle {
  /**
   * stdout and stderr chunks in arrival order. Ends soon after the process
   * ends, even when a background child still holds the pipes open.
   */
  readonly output: AsyncIterable<OutputChunk>;
  /** Settles when the process ends. Never rejects. */
  readonly exit: Promise<RunExit>;
}

export interface RunExit {
  /** null when a signal ended the process or the start failed. */
  readonly code: number | null;
  /** The signal name, for example "SIGKILL". null for a normal exit. */
  readonly signal: string | null;
  /** Set when the command did not start. */
  readonly error?: RunStartError;
}

export interface RunStartError {
  readonly reason: "cwd-not-found" | "cwd-not-a-directory" | "spawn-failed";
  /** Non-sensitive detail for the note. */
  readonly detail?: string;
}
