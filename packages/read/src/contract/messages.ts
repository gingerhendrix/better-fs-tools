import type { NodeKind } from "@better-fs-tools/fs";

import type { ReadInput, ReadRequest } from "./input.ts";
import type { TruncationReason } from "./result.ts";

/** The stage that was running. Later batches add conversion and hooks. */
export type ReadPhase =
  | "input"
  | "resolve"
  | "open"
  | "authorize"
  | "sampling"
  | "scan"
  | "verification";

/**
 * Wording for every note the core owns. Classifiers own their own refusals.
 * Every message that suggests a retry gets `retry`, the text from `retry(next)`.
 */
export interface MessageCatalog {
  /** Prints a canonical retry the way the model must send it. Default: JSON.stringify(next). */
  retry(next: ReadInput): string;
  continuation(c: { request: ReadRequest; retry: string; reason: TruncationReason }): string;
  firstLineTooLong(c: { line: number; maxViewBytes: number; retry: string }): string;
  offsetPastEof(c: { request: ReadRequest; totalLines: number; retry: string }): string;
  offsetUnreached(c: { request: ReadRequest; reachedLine: number; retry: string }): string;
  lineClamped(c: { lines: readonly number[]; total: number; maxChars: number }): string;
  scanLimit(c: { maxScanBytes: number }): string;
  empty(c: { path: string }): string;
  notFound(c: { request: ReadRequest; suggestions: readonly string[] }): string;
  pathRepaired(c: { from: string; to: string }): string;
  notAFile(c: { request: ReadRequest; kind: NodeKind }): string;
  dangerousPath(c: { request: ReadRequest; detail: string | null }): string;
  outsideAllowedRoots(c: { request: ReadRequest; detail: string | null }): string;
  permissionDenied(c: { request: ReadRequest; detail: string | null }): string;
  denied(c: { request: ReadRequest; detail: string | null }): string;
  changedDuringRead(c: { request: ReadRequest; retry: string }): string;
  aborted(c: { phase: ReadPhase }): string;
  invalidInput(c: { detail: string }): string;
  extensionFailed(c: { request: ReadRequest; extension: string; phase: ReadPhase }): string;
  ioError(c: { request: ReadRequest | null }): string;
  unsupportedBackend(c: { request: ReadRequest; detail: string | null }): string;
  weakIdentity(c: { backend: string }): string;
  bufferedBackend(c: { backend: string }): string;
}
