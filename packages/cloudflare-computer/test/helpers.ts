import type {
  FileSystemError,
  FileSystemErrorReason,
  ListOutcome,
  MutationError,
  MutationOutcome,
  OpenOutcome,
  StatOutcome,
  VerifyOutcome,
} from "@better-fs-tools/fs";
import type { Digest, ReadErrorCode, ReadFailure, ReadOk, ReadResult } from "@better-fs-tools/read";

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
  if (result.error.code !== code)
    throw new Error(`expected error ${code}, got ${result.error.code}`);
  return result;
}

/** The static import specifiers of a source file. */
export async function importSpecifiers(file: string): Promise<string[]> {
  const source = await Bun.file(file).text();
  return [...source.matchAll(/^\s*import(?:\s+type)?\s[^;]*?from\s+"([^"]+)"/gmu)].map(
    (match) => match[1] ?? "",
  );
}

/** The package-external import specifiers of every source file in a folder. */
export async function sourceSpecifiers(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of new Bun.Glob("*.ts").scanSync({ cwd: folder, absolute: true })) {
    found.push(
      ...(await importSpecifiers(file)).filter((specifier) => !specifier.startsWith("./")),
    );
  }
  return found;
}

const TEXT = new TextEncoder();

/** A small FNV-1a digest. A Worker host brings its own; the tests need one that is fixed. */
export function testDigest(): Digest {
  const fold = (bytes: Iterable<number>): string => {
    let hash = 2166136261 >>> 0;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return `fnv:${hash.toString(16).padStart(8, "0")}`;
  };
  return {
    id: "test-fnv",
    create() {
      const seen: number[] = [];
      return {
        update: (bytes: Uint8Array) => void seen.push(...bytes),
        digest: () => fold(seen),
      };
    },
    hash: (value: string) => fold(TEXT.encode(value)),
  };
}

/** Assert the shape of a typed error from `stat()`, `write()` or `remove()`. */
export function expectMutationError(
  outcome: MutationOutcome | StatOutcome,
  reason: MutationError["reason"],
): MutationError | FileSystemError {
  if (outcome.ok) throw new Error(`expected a ${reason} error, got a successful outcome`);
  if (outcome.error.reason !== reason) {
    throw new Error(`expected reason ${reason}, got ${outcome.error.reason}`);
  }
  return outcome.error;
}

/** The error of a result, or null when its status is not "error". */
export function errorOf<T extends { readonly status: string }>(
  result: T,
): (T extends { readonly status: "error"; readonly error: infer E } ? E : never) | null {
  return result.status === "error" ? (result as unknown as { readonly error: never }).error : null;
}
