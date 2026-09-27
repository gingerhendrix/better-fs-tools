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
 * Wording for every note the core owns. Classifiers own their own refusals.
 * Every message that suggests a retry gets `retry`, the text from `retry(next)`.
 */
export interface MessageCatalog extends ToolMessages {
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
  /** Tool-neutral: shared authorizers such as denyPaths use it for every tool. */
  denied(c: { path: string; detail: string | null }): string;
  tooLarge(c: { request: ReadRequest; stage: "convert" | "media"; limit: number }): string;
  changedDuringRead(c: { request: ReadRequest; retry: string }): string;
  aborted(c: { phase: ReadPhase }): string;
  invalidInput(c: { detail: string }): string;
  extensionFailed(c: { request: ReadRequest; extension: string; phase: ReadPhase }): string;
  ioError(c: { request: ReadRequest | null }): string;
  unsupportedBackend(c: { request: ReadRequest; detail: string | null }): string;
  viewModified(c: { hook: string }): string;
  weakIdentity(c: { backend: string }): string;
  bufferedBackend(c: { backend: string }): string;
}
