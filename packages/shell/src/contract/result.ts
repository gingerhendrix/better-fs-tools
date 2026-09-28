import type { ContentPart, Note } from "@better-fs-tools/read";

import type { BashRequest } from "./input.ts";

/**
 * "failed": the command ran and exited with a code other than 0. It is a
 * normal result, not a tool error (S4).
 */
export type ShellStatus = "ok" | "failed" | "timeout" | "aborted" | "refused" | "error";

export type ShellErrorCode =
  | "INVALID_INPUT"
  | "CWD_NOT_FOUND"
  | "CWD_NOT_A_DIRECTORY"
  | "DENIED"
  | "REFUSED"
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

export interface ShellError {
  readonly code: ShellErrorCode;
  readonly phase: ShellPhase;
}

/** Facts about one run. null in the report when the command did not start. */
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

export interface ShellReport {
  readonly tool: "bash";
  readonly status: ShellStatus;
  /** null unless status is "refused" or "error". */
  readonly error: ShellError | null;
  /** null when parse failed. */
  readonly request: BashRequest | null;
  readonly run: ShellRun | null;
  readonly output: ShellOutput | null;
  readonly notes: readonly Note[];
}

/** The report plus the formatter's model-facing content. */
export type ShellResult = ShellReport & { readonly content: readonly ContentPart[] };
