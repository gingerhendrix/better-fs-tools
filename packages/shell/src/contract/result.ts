import type { ContentPart, Note, ToolError } from "@better-fs-tools/read";

import type { BashRequest } from "./input.ts";

/**
 * "ok", "failed", and "timeout" describe a command that ran. "failed": it
 * exited with a code other than 0. It is a normal result, not a tool error
 * (S4). "error": the call stopped, or the core stopped the command for a
 * reason other than its timeout. `error.code` says why.
 */
export type ShellStatus = "ok" | "failed" | "timeout" | "error";

/**
 * UPPER_SNAKE, like every tool's error codes. The error note's code is the
 * kebab-case form. DENIED: the authorizer refused. REFUSED: a beforeRun hook
 * refused. ABORTED: the caller's signal fired.
 */
export type ShellErrorCode =
  | "INVALID_INPUT"
  | "CWD_NOT_FOUND"
  | "CWD_NOT_A_DIRECTORY"
  | "DENIED"
  | "REFUSED"
  | "ABORTED"
  | "SPAWN_FAILED"
  | "OUTPUT_CAP"
  | "EXTENSION_FAILED";

export type ShellPhase =
  | "input"
  | "resolve"
  | "authorize"
  | "beforeRun"
  | "env"
  | "run"
  | "spill"
  | "afterRun"
  | "format";

/** The error of a failed call. Same shape as the read and write errors. */
export type ShellError = ToolError<ShellErrorCode, ShellPhase>;

/** Facts about one run. null in an error report when the command did not start. */
export interface ShellRun {
  /** As run, after any beforeRun rewrite. */
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  /** What stopped the command before it ended by itself. null when it ended by itself. */
  readonly stoppedBy: "timeout" | "abort" | "output-cap" | null;
  /** true when the runner did not settle its exit in the grace time after a stop. */
  readonly unconfirmedStop: boolean;
}

/**
 * The bounded view of the merged output. `head` holds all of it when
 * `omittedBytes` is 0. Otherwise the view is `head`, a gap, then `tail`.
 */
export interface ShellOutput {
  readonly head: string;
  /** null when nothing was cut. */
  readonly tail: string | null;
  readonly totalBytes: number;
  readonly totalLines: number;
  readonly omittedBytes: number;
  readonly omittedLines: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  /** The spill sink's reference to the full output. null without a sink. */
  readonly spill: string | null;
}

/**
 * One variant for a command that ran to its own end or its timeout, and one
 * for an error. `status` narrows the union: only the "error" variant has
 * `error`, and it is never null there.
 */
export type ShellReport = ShellRunReport | ShellFailure;

export interface ShellRunReport {
  readonly tool: "bash";
  readonly status: "ok" | "failed" | "timeout";
  readonly request: BashRequest;
  readonly run: ShellRun;
  readonly output: ShellOutput;
  readonly notes: readonly Note[];
}

export interface ShellFailure {
  readonly tool: "bash";
  readonly status: "error";
  readonly error: ShellError;
  /** null when parse failed. */
  readonly request: BashRequest | null;
  /** Set when the command started: an abort, the capture cap, or a failed afterRun hook. */
  readonly run: ShellRun | null;
  readonly output: ShellOutput | null;
  readonly notes: readonly Note[];
}

/** The report plus the formatter's model-facing content. */
export type ShellResult = ShellReport & { readonly content: readonly ContentPart[] };
