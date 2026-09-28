import type { NodeKind } from "@better-fs-tools/fs";
import type { ToolMessages } from "@better-fs-tools/read";

import type { WriteToolName } from "./context.ts";
import type { WriteErrorCode, WritePhase } from "./result.ts";

export type CanonicalParam =
  | "path"
  | "edits"
  | "oldText"
  | "newText"
  | "replaceAll"
  | "content"
  | "patch";

/**
 * Wording for every note the core owns. Every default text says what to do
 * next. No default text names a model parameter: text that names one calls
 * `param(name)`, which a signature overrides.
 */
export interface WriteMessageCatalog extends ToolMessages {
  /**
   * Host name for a canonical parameter. Default: the canonical name. An empty
   * string means the host has no such parameter, and the default texts leave
   * out the advice that names it.
   */
  param(name: CanonicalParam): string;

  invalidInput(c: { tool: WriteToolName; detail: string }): string;
  notFound(c: { tool: WriteToolName; path: string }): string;
  notAFile(c: { path: string; kind: NodeKind }): string;
  dangerousPath(c: { path: string; detail: string | null }): string;
  outsideAllowedRoots(c: { path: string }): string;
  permissionDenied(c: { path: string }): string;
  readOnly(c: { path: string }): string;
  noSpace(c: { path: string }): string;
  unsupportedBackend(c: { path: string; detail: string | null }): string;
  ioError(c: { path: string | null }): string;
  aborted(c: { phase: WritePhase }): string;
  extensionFailed(c: { path: string | null; extension: string; phase: WritePhase }): string;
  lockTimeout(c: { paths: readonly string[] }): string;

  notRead(c: { tool: WriteToolName; path: string; wholeFile: boolean }): string;
  stale(c: { tool: WriteToolName; path: string }): string;
  staleRematched(c: { path: string }): string;
  readBeforeWriteOff(c: { tool: WriteToolName }): string;
  /** `existing` is true when `what` is "content" and the file exists. */
  tooLarge(c: {
    path: string | null;
    what: "file" | "content" | "patch";
    limit: number;
    existing: boolean;
  }): string;
  notText(c: { path: string; code: string }): string;
  exists(c: { tool: WriteToolName; path: string }): string;

  noMatch(c: {
    path: string;
    index: number;
    closest: string | null;
    trailingNewline: "missing" | "extra" | null;
  }): string;
  ambiguousMatch(c: {
    path: string;
    index: number;
    lines: readonly number[];
    total: number;
  }): string;
  matchRefused(c: {
    path: string;
    index: number;
    matcher: string;
    reason: "span" | "boundary" | "escape" | "fuzzy-replace-all" | "too-many";
  }): string;
  overlap(c: { path: string; first: number; second: number }): string;
  noChange(c: { path: string }): string;
  alreadyApplied(c: { path: string; index: number }): string;
  fuzzyMatch(c: {
    path: string;
    index: number;
    matcher: string;
    lines: readonly [number, number];
  }): string;
  repeatedMiss(c: { path: string; misses: number }): string;

  patchParse(c: { line: number; detail: string }): string;
  patchVerifyHeader(): string;
  patchDuplicateTarget(c: { path: string }): string;
  /** An Update or Delete whose file does not exist. */
  patchNotFound(c: { path: string; operation: "update" | "delete" }): string;
  patchMoveExists(c: { path: string; from: string }): string;
  /** `hunk` is one-based. */
  patchContextNotFound(c: { path: string; hunk: number; context: string }): string;
  /** `hunk` is one-based. */
  patchLinesNotFound(c: { path: string; hunk: number; lines: readonly string[] }): string;
  /** `hunk` is one-based. */
  patchFuzzyMatch(c: {
    path: string;
    hunk: number;
    matcher: string;
    lines: readonly [number, number];
  }): string;
  /** `files` is set when the rollback failed: the state of every file the patch targets. */
  patchCommitFailed(c: {
    path: string;
    code: WriteErrorCode;
    rolledBack: boolean;
    files: readonly { readonly path: string; readonly state: string }[];
  }): string;

  notAtomic(c: { backend: string }): string;
  noCompareAndSwap(c: { backend: string }): string;
  modeNotKept(c: { backend: string }): string;
  directoriesCreated(c: { paths: readonly string[] }): string;
  userModified(c: { path: string }): string;
  hookRewrote(c: { hook: string; path: string }): string;
  hookFailed(c: { hook: string; path: string }): string;
}
