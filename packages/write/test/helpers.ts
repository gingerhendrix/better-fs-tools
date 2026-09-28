import { memoryFileSystem } from "@better-fs-tools/fs";
import type {
  MemoryFileSystem,
  MemoryFileSystemOptions,
  WritableFileSystem,
  WriteOptions,
} from "@better-fs-tools/fs";
import { createReadTool } from "@better-fs-tools/read";
import type { Digest, Note, ReadStateStore, ReadTool } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";

import { createApplyPatchTool, createEditTool, createWriteTool } from "../src/index.ts";
import type {
  ApplyPatchTool,
  ApplyPatchToolDeps,
  EditTool,
  EditToolDeps,
  MutationResult,
  WriteTool,
  WriteToolDeps,
} from "../src/index.ts";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** The fixed clock every test uses. */
export const FIXED_DATE = new Date("2026-09-28T00:00:00.000Z");

/** Deterministic, dependency-free FNV-1a digest, the same as the read tests use. */
export function testDigest(id = "test-fnv"): Digest {
  const fold = (bytes: Uint8Array): string => {
    let hash = 2166136261 >>> 0;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  };
  return {
    id,
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
  readonly files?: Record<string, string | Uint8Array>;
  readonly fsOptions?: MemoryFileSystemOptions;
  /** Replaces the memory filesystem the write tool sees. The read tool still reads `fs`. */
  readonly writeFs?: (fs: MemoryFileSystem) => WritableFileSystem;
  readonly deps?: Omit<WriteToolDeps, "fs">;
  /** Added to `deps` for the edit tool only. */
  readonly editDeps?: Omit<EditToolDeps, "fs">;
  /** Added to `deps` for the apply_patch tool only. */
  readonly patchDeps?: Omit<ApplyPatchToolDeps, "fs">;
}

export interface Harness {
  readonly fs: MemoryFileSystem;
  readonly state: ReadStateStore;
  readonly digest: Digest;
  readonly read: ReadTool;
  readonly write: WriteTool;
  readonly edit: EditTool;
  readonly applyPatch: ApplyPatchTool;
}

/**
 * A read tool and the three write tools over one memory filesystem, one
 * store, one digest, and the fixed clock.
 */
export function harness(options: HarnessOptions = {}): Harness {
  const fs = memoryFileSystem({ files: options.files ?? {}, ...options.fsOptions });
  const state = createMemoryStore();
  const digest = testDigest();
  const clock = () => FIXED_DATE;
  const read = createReadTool({ fs, state, digest, clock });
  const shared = { fs: options.writeFs?.(fs) ?? fs, state, digest, clock, ...options.deps };
  const write = createWriteTool(shared);
  const edit = createEditTool({ ...shared, ...options.editDeps });
  const applyPatch = createApplyPatchTool({ ...shared, ...options.patchDeps });
  return { fs, state, digest, read, write, edit, applyPatch };
}

/** The current text of a memory file, or null. */
export function text(fs: MemoryFileSystem, path: string): string | null {
  const entry = fs.peek(path);
  return entry === null ? null : DECODER.decode(entry.bytes);
}

export function note(result: { readonly notes: readonly Note[] }, code: string): Note | undefined {
  return result.notes.find((entry) => entry.code === code);
}

export function codes(result: { readonly notes: readonly Note[] }): string[] {
  return result.notes.map((entry) => entry.code);
}

export function errorCode(result: MutationResult): string | null {
  return errorOf(result)?.code ?? null;
}

/**
 * A backend that reports compareAndSwap: false and does not check
 * preconditions: every write goes through with "any". The core must catch
 * staleness itself.
 */
export function withoutCompareAndSwap(fs: MemoryFileSystem): WritableFileSystem {
  return {
    id: "no-cas",
    capabilities: fs.capabilities,
    paths: fs.paths,
    writeCapabilities: { ...fs.writeCapabilities, compareAndSwap: false },
    open: (path, options) => fs.open(path, options),
    stat: (path, options) => fs.stat(path, options),
    write: (path, bytes, options: WriteOptions) =>
      fs.write(path, bytes, { ...options, precondition: { kind: "any" } }),
  };
}

/** A promise with its resolve function, for ordering concurrent calls. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Codex patch text: the Begin and End lines around the given lines. */
export function patchText(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

/** The error of a result, or null when its status is not "error". */
export function errorOf<T extends { readonly status: string }>(
  result: T,
): (T extends { readonly status: "error"; readonly error: infer E } ? E : never) | null {
  return result.status === "error" ? (result as unknown as { readonly error: never }).error : null;
}
