import type { NodeKind } from "@better-fs-tools/fs";

import type { ToolMessages } from "./base.ts";
import type { ReadInput, ReadRequest } from "./input.ts";
import type { TruncationReason } from "./result.ts";

/** The stage that was running. */
export type ReadPhase =
  | "input"
  | "resolve"
  | "open"
  | "authorize"
  | "sampling"
  | "conversion"
  | "scan"
  | "verification"
  | "hooks";

/**
 * Wording for every note the read tool writes. Classifiers word their own refusals.
 * Every message that suggests a retry gets `retry`, the text from `retry(next)`.
 */
export interface ReadMessageCatalog extends ToolMessages {
  /** Prints a canonical retry the way the model must send it. Default: JSON.stringify(next). */
  retry(next: ReadInput): string;
  continuation(c: { request: ReadRequest; retry: string; reason: TruncationReason }): string;
  firstLineTooLong(c: { line: number; maxViewBytes: number; retry: string }): string;
  offsetPastEof(c: { request: ReadRequest; totalLines: number; retry: string }): string;
  offsetUnreached(c: { request: ReadRequest; reachedLine: number; retry: string }): string;
  lineClamped(c: { lines: readonly number[]; total: number; maxChars: number }): string;
  /** The requested line count was over limits.maxLines, so the view uses the maximum. */
  limitClamped(c: { requested: number; max: number }): string;
  scanLimit(c: { maxScanBytes: number }): string;
  empty(c: { path: string }): string;
  notFound(c: { request: ReadRequest; suggestions: readonly string[] }): string;
  pathRepaired(c: { from: string; to: string }): string;
  notAFile(c: { request: ReadRequest; kind: NodeKind }): string;
  dangerousPath(c: { request: ReadRequest; detail: string | null }): string;
  outsideAllowedRoots(c: { request: ReadRequest; detail: string | null }): string;
  permissionDenied(c: { request: ReadRequest; detail: string | null }): string;
  /** Used by shared authorizers such as denyPaths, for every tool. */
  denied(c: { path: string; detail: string | null }): string;
  /** `stage` "backend" means the filesystem backend refused the size before any byte was read. */
  tooLarge(c: {
    request: ReadRequest;
    stage: "convert" | "media" | "backend";
    limit: number;
  }): string;
  changedDuringRead(c: { request: ReadRequest; retry: string }): string;
  aborted(c: { phase: ReadPhase }): string;
  invalidInput(c: { detail: string }): string;
  extensionFailed(c: { request: ReadRequest; extension: string; phase: ReadPhase }): string;
  ioError(c: { request: ReadRequest | null }): string;
  unsupportedBackend(c: { request: ReadRequest; detail: string | null }): string;
  viewModified(c: { hook: string }): string;
  /** The formatter threw or returned neither a string nor an array. */
  formatterFailed(c: { formatter: string }): string;
}
