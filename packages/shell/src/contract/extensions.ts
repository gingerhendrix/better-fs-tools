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
import type { ShellError, ShellOutput, ShellRun } from "./result.ts";

/** Given to every shell host function. One object for each call. */
export interface ShellHookContext<THost = undefined> extends ToolHookContext<THost> {
  readonly tool: "bash";
  readonly request: BashRequest;
  readonly limits: Readonly<ShellLimits>;
  readonly messages: Readonly<ShellMessageCatalog>;
  readonly call: ToolCallContext<THost>;
}

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

/**
 * Host policy. Runs after the beforeRun hooks, so it sees the command that
 * will run. A ToolAuthorizer from read fits here.
 */
export interface ShellAuthorizer<THost = undefined> {
  readonly id: string;
  readonly authorize: (
    target: ShellAuthorizeTarget,
    ctx: ShellHookContext<THost>,
  ) => AccessDecision | Promise<AccessDecision>;
}

export interface PlannedRun {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
}

/**
 * The same `{ allow }` shape as an authorize decision. `command` rewrites the
 * command. A refusal gives REFUSED, with `note` or a default refused note.
 */
export type BeforeRunDecision =
  | { readonly allow: true; readonly command?: string; readonly notes?: readonly Note[] }
  | { readonly allow: false; readonly note?: Note };

/**
 * A reusable check or rewrite. Runs in order before authorize, so the
 * authorizer sees the final command. A rewrite feeds the next hook.
 */
export interface BeforeRunHook<THost = undefined> {
  readonly id: string;
  beforeRun(
    run: PlannedRun,
    ctx: ShellHookContext<THost>,
  ): BeforeRunDecision | Promise<BeforeRunDecision>;
}

/** Returns the whole environment of the command. */
export type ShellEnv<THost = undefined> = (
  run: PlannedRun,
  ctx: ShellHookContext<THost>,
) => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;

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

/** What afterRun hooks see: a run that started, with its status. */
export type RunOutcome =
  | {
      readonly status: "ok" | "failed" | "timeout";
      readonly run: ShellRun;
      readonly output: ShellOutput;
      readonly notes: readonly Note[];
    }
  | {
      readonly status: "error";
      readonly error: ShellError;
      readonly run: ShellRun;
      readonly output: ShellOutput;
      readonly notes: readonly Note[];
    };

/**
 * What an afterRun hook may change. A field left out keeps its value. `notes`
 * replaces the whole list, so keep the notes you were given.
 */
export interface AfterRunUpdate {
  readonly output?: ShellOutput;
  readonly notes?: readonly Note[];
}

export interface AfterRunHook<THost = undefined> {
  readonly id: string;
  /** Runs in order on every run that started. Returns the output view and the notes to keep. */
  afterRun(
    outcome: RunOutcome,
    ctx: ShellHookContext<THost>,
  ): AfterRunUpdate | Promise<AfterRunUpdate>;
}
