import type { NodeKind } from "@better-fs-tools/fs";
import type { ToolMessages } from "@better-fs-tools/read";

import type { WriteToolName } from "./context.ts";
import type { WriteErrorCode, WritePhase } from "./result.ts";

export type WriteCanonicalParam =
  | "path"
  | "edits"
  | "oldText"
  | "newText"
  | "replaceAll"
  | "content"
  | "patch";

/**
 * What the tool wrote for one loose hit, compared line by line with the
 * model's new lines. Each count is a number of lines.
 */
export interface FuzzyWrite {
  /** Lines written with the file's own characters, not the model's. */
  readonly keptLines: number;
  /** Lines that kept the file's CR, which the model's line did not have. */
  readonly keptLineEnds: number;
  /** Lines that the matcher changed in another way, for example a new indentation. */
  readonly adaptedLines: number;
}

/**
 * Wording for every note the write tools produce. Text that names a model
 * parameter gets the name from `param(name)`, which a signature overrides.
 */
export interface WriteMessageCatalog extends ToolMessages {
  /**
   * Host name for a canonical parameter. Default: the canonical name. An empty
   * string means the host has no such parameter, and the default texts leave
   * out the advice that names it.
   */
  param(name: WriteCanonicalParam): string;

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
  /** A guard refused a change and gave no note. */
  guardRefused(c: { guard: string; path: string }): string;

  notRead(c: { tool: WriteToolName; path: string; wholeFile: boolean }): string;
  stale(c: { tool: WriteToolName; path: string }): string;
  staleRematched(c: { path: string }): string;
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
  /** `written` is optional, so a host's own message can leave it out. */
  fuzzyMatch(c: {
    path: string;
    index: number;
    matcher: string;
    lines: readonly [number, number];
    written?: FuzzyWrite;
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
  /**
   * `hunk` is one-based. `from` is the one-based line where the search
   * started. `context` is the one-based line that the `@@` text matched, or
   * null for a bare `@@`. The tool also tried the old lines at that line.
   * Both are optional, so a host's own message can leave them out.
   */
  patchLinesNotFound(c: {
    path: string;
    hunk: number;
    lines: readonly string[];
    from?: number;
    context?: number | null;
  }): string;
  /** `hunk` is one-based. `written` is optional, as in fuzzyMatch. */
  patchFuzzyMatch(c: {
    path: string;
    hunk: number;
    matcher: string;
    lines: readonly [number, number];
    written?: FuzzyWrite;
  }): string;
  /** `files` is set when the rollback failed: the state of every file the patch targets. */
  patchCommitFailed(c: {
    path: string;
    code: WriteErrorCode;
    rolledBack: boolean;
    files: readonly { readonly path: string; readonly state: string }[];
  }): string;

  userModified(c: { path: string }): string;
  hookRewrote(c: { hook: string; path: string }): string;
}
