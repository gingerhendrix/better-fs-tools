import { memoryFileSystem } from "@better-fs-tools/fs";
import type {
  FileSystem,
  ListOptions,
  MemoryFileSystem,
  MemoryFileSystemOptions,
} from "@better-fs-tools/fs";

import { createReadTool } from "../src/index.ts";
import type {
  Digest,
  ReadErrorCode,
  ReadFailure,
  ReadLimits,
  ReadMedia,
  ReadNote,
  ReadOk,
  ReadResult,
  ReadTool,
  ReadToolDeps,
  ReadUnsupported,
} from "../src/index.ts";

const ENCODER = new TextEncoder();

/** The fixed clock every test uses. */
export const FIXED_DATE = new Date("2026-08-22T00:00:00.000Z");

/** Deterministic, dependency-free FNV-1a digest for tests. */
export function testDigest(): Digest {
  const fold = (bytes: Uint8Array): string => {
    let hash = 2166136261 >>> 0;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  };
  return {
    id: "test-fnv",
    create() {
      const chunks: number[] = [];
      return {
        update(bytes: Uint8Array) {
          for (const byte of bytes) chunks.push(byte);
        },
        digest: () => `fnv:${fold(Uint8Array.from(chunks))}`,
      };
    },
    hash: (value: string) => `fnv:${fold(ENCODER.encode(value))}`,
  };
}

export interface HarnessOptions {
  files?: Record<string, string | Uint8Array>;
  limits?: Partial<ReadLimits>;
  fsOptions?: MemoryFileSystemOptions;
  deps?: Omit<ReadToolDeps, "fs">;
}

/** A read tool over a memory filesystem with the test digest and the fixed clock. */
export function harness(options: HarnessOptions = {}): { read: ReadTool; fs: MemoryFileSystem } {
  const fs = memoryFileSystem({ files: options.files ?? {}, ...options.fsOptions });
  const read = createReadTool({
    fs,
    digest: testDigest(),
    clock: () => FIXED_DATE,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...options.deps,
  });
  return { read, fs };
}

export function note(result: ReadResult, code: string): ReadNote | undefined {
  return result.notes.find((entry) => entry.code === code);
}

export function lineText(result: ReadResult): string[] {
  return result.status === "ok" ? result.view.lines.map((line) => line.text) : [];
}

/** Narrows to ok, failing the test with the actual status when it is not. */
export function expectOk(result: ReadResult): ReadOk & ReadResult {
  if (result.status !== "ok") {
    const code = result.status === "error" ? ` (${result.error.code})` : "";
    throw new Error(`expected ok, got ${result.status}${code}`);
  }
  return result;
}

/** Narrows to media. */
export function expectMedia(result: ReadResult): ReadMedia & ReadResult {
  if (result.status !== "media") {
    const code = result.status === "error" ? ` (${result.error.code})` : "";
    throw new Error(`expected media, got ${result.status}${code}`);
  }
  return result;
}

/** Narrows to unsupported, optionally asserting the classifier's code. */
export function expectUnsupported(result: ReadResult, code?: string): ReadUnsupported & ReadResult {
  if (result.status !== "unsupported")
    throw new Error(`expected unsupported, got ${result.status}`);
  if (code !== undefined && result.code !== code) {
    throw new Error(`expected unsupported code ${code}, got ${result.code}`);
  }
  return result;
}

/** Narrows to error, asserting the code. */
export function expectFailure(result: ReadResult, code: ReadErrorCode): ReadFailure & ReadResult {
  if (result.status !== "error") throw new Error(`expected error ${code}, got ${result.status}`);
  if (result.error.code !== code)
    throw new Error(`expected error ${code}, got ${result.error.code}`);
  return result;
}

export interface SpiedFileSystem {
  readonly fs: FileSystem;
  /** Paths passed to open(), in order. */
  readonly opens: string[];
  /** Directories passed to list(), in order. */
  readonly lists: string[];
}

/** Wraps a filesystem and records every open() and list() path. */
export function spyFileSystem(inner: FileSystem): SpiedFileSystem {
  const opens: string[] = [];
  const lists: string[] = [];
  const list = inner.list?.bind(inner);
  const fs: FileSystem = {
    id: inner.id,
    capabilities: inner.capabilities,
    paths: inner.paths,
    open: (path, options) => {
      opens.push(path);
      return inner.open(path, options);
    },
    ...(list === undefined
      ? {}
      : {
          list: (path: string, options: ListOptions) => {
            lists.push(path);
            return list(path, options);
          },
        }),
  };
  return { fs, opens, lists };
}
