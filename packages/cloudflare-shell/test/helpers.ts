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

export function expectOk(result: ReadResult): ReadOk & ReadResult {
  if (result.status !== "ok")
    throw new Error(
      `expected ok, got ${result.status} (${"code" in result ? result.code : "no code"})`,
    );
  return result;
}

export function expectFailure(result: ReadResult, code: ReadErrorCode): ReadFailure & ReadResult {
  if (result.status !== "error") throw new Error(`expected error ${code}, got ${result.status}`);
  if (result.error.code !== code)
    throw new Error(`expected error ${code}, got ${result.error.code}`);
  return result;
}

async function staticImportSpecifiers(file: string): Promise<string[]> {
  const source = await Bun.file(file).text();
  return [...source.matchAll(/^\s*import(?:\s+type)?\s[^;]*?from\s+"([^"]+)"/gmu)].map(
    (match) => match[1] ?? "",
  );
}

export async function externalImportSpecifiers(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of new Bun.Glob("*.ts").scanSync({ cwd: folder, absolute: true })) {
    found.push(
      ...(await staticImportSpecifiers(file)).filter((specifier) => !specifier.startsWith("./")),
    );
  }
  return found;
}

const TEXT = new TextEncoder();

export function testDigest(): Digest {
  const fnv1a = (bytes: Iterable<number>): string => {
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
        digest: () => fnv1a(seen),
      };
    },
    hash: (value: string) => fnv1a(TEXT.encode(value)),
  };
}

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

export function errorOf<T extends { readonly status: string }>(
  result: T,
): (T extends { readonly status: "error"; readonly error: infer E } ? E : never) | null {
  return result.status === "error" ? (result as unknown as { readonly error: never }).error : null;
}
