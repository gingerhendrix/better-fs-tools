import type {
  FileSystemError,
  FileSystemErrorReason,
  ListOutcome,
  OpenOutcome,
  VerifyOutcome,
} from "@better-fs-tools/fs";
import type { ReadErrorCode, ReadFailure, ReadOk, ReadResult } from "@better-fs-tools/read";

/**
 * Assert the shape of a typed filesystem error from `open()`, `list()` or
 * `verify()`. Adapters return these; they never throw.
 */
export function expectFsError(
  outcome: OpenOutcome | ListOutcome | VerifyOutcome,
  reason: FileSystemErrorReason,
  cause?: { code?: string; phase?: string },
): FileSystemError {
  if (outcome.ok) throw new Error(`expected a ${reason} error, got a successful outcome`);
  const { error } = outcome;
  if (error.reason !== reason) throw new Error(`expected reason ${reason}, got ${error.reason}`);
  if (cause?.code !== undefined && error.cause?.code !== cause.code) {
    throw new Error(`expected cause code ${cause.code}, got ${error.cause?.code}`);
  }
  if (cause?.phase !== undefined && error.cause?.phase !== cause.phase) {
    throw new Error(`expected cause phase ${cause.phase}, got ${error.cause?.phase}`);
  }
  return error;
}

/** Narrows to ok, failing the test with the actual status when it is not. */
export function expectOk(result: ReadResult): ReadOk & ReadResult {
  if (result.status !== "ok")
    throw new Error(
      `expected ok, got ${result.status} (${"code" in result ? result.code : "no code"})`,
    );
  return result;
}

/** Narrows to error, asserting the code. */
export function expectFailure(result: ReadResult, code: ReadErrorCode): ReadFailure & ReadResult {
  if (result.status !== "error") throw new Error(`expected error ${code}, got ${result.status}`);
  if (result.code !== code) throw new Error(`expected error ${code}, got ${result.code}`);
  return result;
}

/** The static import specifiers of a source file. */
export async function importSpecifiers(file: string): Promise<string[]> {
  const source = await Bun.file(file).text();
  return [...source.matchAll(/^\s*import(?:\s+type)?\s[^;]*?from\s+"([^"]+)"/gmu)].map(
    (match) => match[1] ?? "",
  );
}
