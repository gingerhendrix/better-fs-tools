import type { ToolExecutionOptions } from "ai";

import { posixPaths } from "@better-fs-tools/fs";
import type { FileSystem, OpenFile, OpenOutcome } from "@better-fs-tools/fs";
import type { ReadErrorCode, ReadOk, ReadResult } from "@better-fs-tools/read";

export const CLOCK = (): Date => new Date("2026-08-22T00:00:00.000Z");

export function executeOptions(
  signal?: AbortSignal,
): ToolExecutionOptions<Record<string, unknown>> {
  return {
    toolCallId: "read-call",
    messages: [],
    context: {},
    ...(signal === undefined ? {} : { abortSignal: signal }),
  };
}

export function expectOk(result: ReadResult): ReadOk & ReadResult {
  if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
  return result;
}

export function expectFailure(result: ReadResult, code: ReadErrorCode): ReadResult {
  if (result.status !== "error" || result.error.code !== code) {
    throw new Error(`expected error ${code}, got ${result.status}`);
  }
  return result;
}

/** Stalls after the first chunk so an abort lands mid-scan, not before the scan starts. */
export function stallingFileSystem(
  path: string,
  first: string,
): { fs: FileSystem; stalled: Promise<void>; release: () => void } {
  const held = Promise.withResolvers<void>();
  const arrived = Promise.withResolvers<void>();
  const file: OpenFile = {
    info: {
      resolvedPath: path,
      displayPath: path,
      size: null,
      mtimeMs: null,
      identity: "stalling",
      mimeType: null,
    },
    async *bytes() {
      yield new TextEncoder().encode(first);
      arrived.resolve();
      await held.promise;
    },
    verify: async () => ({ ok: true, changed: false }),
    close: async () => {},
  };
  return {
    stalled: arrived.promise,
    release: () => held.resolve(),
    fs: {
      id: "stalling",
      capabilities: { identity: true },
      paths: posixPaths,
      open: async (requested): Promise<OpenOutcome> =>
        requested === path ? { ok: true, file } : { ok: false, error: { reason: "not-found" } },
    },
  };
}

export function errorOf<T extends { readonly status: string }>(
  result: T,
): (T extends { readonly status: "error"; readonly error: infer E } ? E : never) | null {
  return result.status === "error" ? (result as unknown as { readonly error: never }).error : null;
}
