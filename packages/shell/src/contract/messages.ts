import type { ToolMessages } from "@better-fs-tools/read";

import type { ShellPhase } from "./result.ts";

export type ShellCanonicalParam = "command" | "timeoutMs" | "cwd";

/**
 * Wording for every note and status line the core owns. Text that names a
 * model parameter calls `param(name)`, which a signature overrides.
 */
export interface ShellMessageCatalog extends ToolMessages {
  /** Host name for a canonical parameter. An empty string means the host has no such parameter. */
  param(name: ShellCanonicalParam): string;
  /** How a timeout value reads in the host's unit, for example "120 s". */
  duration(ms: number): string;

  invalidInput(c: { detail: string }): string;
  cwdNotFound(c: { cwd: string }): string;
  cwdNotADirectory(c: { cwd: string }): string;
  refused(c: { hook: string }): string;
  spawnFailed(c: { detail: string | null }): string;
  extensionFailed(c: { extension: string; phase: ShellPhase }): string;
  timeoutClamped(c: { requestedMs: number; maxMs: number }): string;

  /** The first line of an ended run. */
  exited(c: { code: number | null; signal: string | null; durationMs: number }): string;
  timedOut(c: { timeoutMs: number }): string;
  aborted(c: { durationMs: number }): string;
  outputCap(c: { limit: number }): string;
  unconfirmedStop(): string;
  abortedBeforeStart(): string;
  spillFailed(c: { sink: string }): string;
  /** The output stream failed (`detail`), or gave chunks that were not output. */
  outputIncomplete(c: { detail: string | null; skippedChunks: number }): string;
  noOutput(): string;
  /** The line between the head and the tail. */
  omitted(c: { lines: number; bytes: number; spill: string | null }): string;
}
