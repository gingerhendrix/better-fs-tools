import type {
  AccessDecision,
  AccessTarget,
  Note,
  ToolCallContext,
  ToolHookContext,
} from "@better-fs-tools/read";

import type { BashRequest } from "./input.ts";
import type { ShellLimits } from "./limits.ts";
import type { ShellMessageCatalog } from "./messages.ts";
import type { ShellOutput, ShellRun, ShellStatus } from "./result.ts";

/** Given to every shell host function. One object for each call. */
export interface ShellHookContext<THost = undefined> extends ToolHookContext<THost> {
  readonly tool: "bash";
  readonly request: BashRequest;
  readonly limits: Readonly<ShellLimits>;
  readonly messages: Readonly<ShellMessageCatalog>;
  readonly call: ToolCallContext<THost>;
}

/* Authorize */

/**
 * The path fields name the working directory, so a read tool authorizer
 * (a ToolAuthorizer) that checks paths also works on the cwd.
 */
export interface ShellAuthorizeTarget extends AccessTarget {
  readonly action: "run";
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
}

/** Host policy. The package ships no authorizers. A ToolAuthorizer from read fits here. */
export interface ShellAuthorizer<THost = undefined> {
  readonly id: string;
  authorize(
    target: ShellAuthorizeTarget,
    ctx: ShellHookContext<THost>,
  ): AccessDecision | Promise<AccessDecision>;
}

/* Before run */

export interface PlannedRun {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
}

export type BeforeRunDecision =
  | { readonly kind: "continue"; readonly command?: string; readonly notes?: readonly Note[] }
  | { readonly kind: "refuse"; readonly note: Note };

/** A reusable check or rewrite. Runs in order after authorize. A rewrite feeds the next hook. */
export interface BeforeRunHook<THost = undefined> {
  readonly id: string;
  beforeRun(
    run: PlannedRun,
    ctx: ShellHookContext<THost>,
  ): BeforeRunDecision | Promise<BeforeRunDecision>;
}

/* Environment */

/** Returns the whole environment of the command. */
export type ShellEnv<THost = undefined> = (
  run: PlannedRun,
  ctx: ShellHookContext<THost>,
) => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;

/* Spill */

export interface SpillWriter {
  write(bytes: Uint8Array): Promise<void>;
  /** Returns a reference the truncation note shows, for example a path. */
  close(): Promise<string>;
}

/** Receives every output byte, in arrival order. */
export interface SpillSink<THost = undefined> {
  readonly id: string;
  open(run: PlannedRun, ctx: ShellHookContext<THost>): Promise<SpillWriter>;
}

/* After run */

/** What afterRun hooks see and may change. */
export interface RunOutcome {
  readonly status: ShellStatus;
  readonly run: ShellRun;
  readonly output: ShellOutput;
  readonly notes: readonly Note[];
}

export interface AfterRunHook<THost = undefined> {
  readonly id: string;
  /**
   * Runs in order on every run that started. May change the output view and
   * the notes. A change to `status` or `run` is ignored.
   */
  afterRun(outcome: RunOutcome, ctx: ShellHookContext<THost>): RunOutcome | Promise<RunOutcome>;
}
