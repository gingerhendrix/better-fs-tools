import type { FileSystemError, OpenOptions } from "./contract.ts";
import { posixPaths, resolvePosix } from "./paths.ts";
import type {
  MutateOptions,
  MutatedFile,
  MutationError,
  MutationOutcome,
  Precondition,
  StageOutcome,
  StatOutcome,
  WritableFileSystem,
  WriteCapabilities,
  WriteOptions,
} from "./writable.ts";

export const DEFAULT_MODE = 0o644;

/** Called with the resolved path just before the state changes, after every other check passed. */
export type MemoryFaults = (
  operation: "write" | "stage" | "publish" | "remove",
  path: string,
) => MutationError | null;

export interface MemoryEntry {
  bytes: Uint8Array;
  generation: number;
  mimeType: string | null;
  mode: number;
}

export interface MemoryState {
  readonly files: Map<string, MemoryEntry>;
  readonly directories: Set<string>;
  readonly identity: boolean;
  readonly maxBufferedBytes: number;
  checkAccess(absolute: string, signal: AbortSignal | undefined): FileSystemError | null;
  versionOf(absolute: string, entry: MemoryEntry): string;
  /** An undefined mode keeps the existing file's mode, else DEFAULT_MODE. */
  put(absolute: string, bytes: Uint8Array, mode: number | undefined): MemoryEntry;
  drop(absolute: string): void;
}

export interface MemoryWriteSettings {
  readonly writeCapabilities: WriteCapabilities;
  readonly readOnly: boolean;
  readonly faults: MemoryFaults;
}

type MemoryWrites = Pick<WritableFileSystem, "stat" | "write"> &
  Required<Pick<WritableFileSystem, "stage" | "remove">>;

export function memoryWrites(state: MemoryState, settings: MemoryWriteSettings): MemoryWrites {
  const { writeCapabilities, readOnly, faults } = settings;
  const unsettledStagedPaths: string[] = [];

  /** Missing ancestors, outermost first. null when an ancestor is a file. */
  const missingParents = (absolute: string): string[] | null => {
    const missing: string[] = [];
    let parent = posixPaths.dirname(absolute);
    while (!state.directories.has(parent)) {
      if (state.files.has(parent)) return null;
      missing.unshift(parent);
      parent = posixPaths.dirname(parent);
    }
    return missing;
  };

  const stat = async (path: string, callOptions: OpenOptions = {}): Promise<StatOutcome> => {
    const absolute = resolvePosix("/", path);
    const refused = state.checkAccess(absolute, callOptions.signal);
    if (refused !== null) return { ok: false, error: refused };
    const entry = state.files.get(absolute);
    if (entry === undefined) {
      const missing = missingParents(absolute);
      if (missing === null) {
        return { ok: false, error: { reason: "not-found", detail: "a parent is not a directory" } };
      }
      return {
        ok: true,
        stat: {
          exists: false,
          resolvedPath: absolute,
          displayPath: absolute,
          missingDirectories: missing,
        },
      };
    }
    const version = state.versionOf(absolute, entry);
    return {
      ok: true,
      stat: {
        exists: true,
        resolvedPath: absolute,
        displayPath: absolute,
        size: entry.bytes.byteLength,
        mtimeMs: null,
        identity: state.identity ? version : null,
        version,
        mode: entry.mode,
        hardLinks: 1,
      },
    };
  };

  const conflict = (absolute: string, precondition: Precondition): MutationError | null => {
    const entry = state.files.get(absolute);
    switch (precondition.kind) {
      case "absent":
        return entry === undefined ? null : { reason: "exists" };
      case "version":
        return entry !== undefined && state.versionOf(absolute, entry) === precondition.version
          ? null
          : { reason: "changed" };
      case "any":
        return null;
    }
  };

  const checkBeforeWrite = (
    operation: "write" | "stage",
    absolute: string,
    bytes: Uint8Array,
    writeOptions: WriteOptions,
  ): { readonly missing: readonly string[] } | { readonly error: MutationError } => {
    const refused =
      state.checkAccess(absolute, writeOptions.signal) ??
      (readOnly ? { reason: "read-only" as const } : null) ??
      conflict(absolute, writeOptions.precondition);
    if (refused !== null) return { error: refused };
    if (bytes.byteLength > state.maxBufferedBytes) {
      return {
        error: {
          reason: "too-large",
          limit: state.maxBufferedBytes,
          size: bytes.byteLength,
          detail: `object exceeds the ${state.maxBufferedBytes}-byte buffered ceiling`,
        },
      };
    }
    const missing = missingParents(absolute);
    if (missing === null) {
      return { error: { reason: "not-found", detail: "a parent is not a directory" } };
    }
    if (missing.length > 0 && !writeOptions.createParents) {
      return { error: { reason: "not-found", detail: "the parent directory does not exist" } };
    }
    const fault = faults(operation, absolute);
    return fault === null ? { missing } : { error: fault };
  };

  const commit = (
    absolute: string,
    bytes: Uint8Array,
    mode: number | undefined,
    created: readonly string[],
  ): MutatedFile => {
    for (const directory of created) state.directories.add(directory);
    const keepExistingMode = state.files.has(absolute) && writeCapabilities.preserveMode;
    const entry = state.put(absolute, bytes, keepExistingMode ? undefined : (mode ?? DEFAULT_MODE));
    const version = state.versionOf(absolute, entry);
    return {
      resolvedPath: absolute,
      displayPath: absolute,
      version,
      identity: state.identity ? version : null,
      size: bytes.byteLength,
      createdDirectories: created,
      atomic: writeCapabilities.atomic,
    };
  };

  const write = async (
    path: string,
    bytes: Uint8Array,
    writeOptions: WriteOptions,
  ): Promise<MutationOutcome> => {
    const absolute = resolvePosix("/", path);
    const prepared = checkBeforeWrite("write", absolute, bytes, writeOptions);
    if ("error" in prepared) return { ok: false, error: prepared.error };
    return {
      ok: true,
      file: commit(absolute, Uint8Array.from(bytes), writeOptions.mode, prepared.missing),
    };
  };

  const isEmptyDirectory = (directory: string): boolean => {
    const inside = (path: string) => path !== directory && posixPaths.dirname(path) === directory;
    for (const path of state.files.keys()) if (inside(path)) return false;
    for (const path of state.directories) if (inside(path)) return false;
    return !unsettledStagedPaths.some(inside);
  };

  const stage = async (
    path: string,
    bytes: Uint8Array,
    writeOptions: WriteOptions,
  ): Promise<StageOutcome> => {
    const absolute = resolvePosix("/", path);
    const prepared = checkBeforeWrite("stage", absolute, bytes, writeOptions);
    if ("error" in prepared) return { ok: false, error: prepared.error };
    const { missing } = prepared;
    const staged = Uint8Array.from(bytes);
    // Parents exist from stage() on, like a temp file next to the target.
    for (const directory of missing) state.directories.add(directory);
    unsettledStagedPaths.push(absolute);
    let publishCalled = false;
    let publishedOrDiscarded = false;
    const release = () => unsettledStagedPaths.splice(unsettledStagedPaths.indexOf(absolute), 1);
    return {
      ok: true,
      staged: Object.freeze({
        resolvedPath: absolute,
        async publish(): Promise<MutationOutcome> {
          if (publishCalled || publishedOrDiscarded)
            throw new TypeError("memory staged write: publish() is single-use");
          publishCalled = true;
          const refused =
            state.checkAccess(absolute, undefined) ??
            conflict(absolute, writeOptions.precondition) ??
            faults("publish", absolute);
          if (refused !== null) return { ok: false, error: refused };
          publishedOrDiscarded = true;
          release();
          return { ok: true, file: commit(absolute, staged, writeOptions.mode, missing) };
        },
        async discard(): Promise<void> {
          if (publishedOrDiscarded) return;
          publishedOrDiscarded = true;
          release();
          for (const directory of [...missing].reverse()) {
            if (state.directories.has(directory) && isEmptyDirectory(directory)) {
              state.directories.delete(directory);
            }
          }
        },
      }),
    };
  };

  const remove = async (path: string, removeOptions: MutateOptions): Promise<MutationOutcome> => {
    const absolute = resolvePosix("/", path);
    const refused =
      state.checkAccess(absolute, removeOptions.signal) ??
      (readOnly ? { reason: "read-only" as const } : null) ??
      conflict(absolute, removeOptions.precondition) ??
      (state.files.has(absolute) ? null : { reason: "not-found" as const }) ??
      faults("remove", absolute);
    if (refused !== null) return { ok: false, error: refused };
    state.drop(absolute);
    return {
      ok: true,
      file: {
        resolvedPath: absolute,
        displayPath: absolute,
        version: null,
        identity: null,
        size: null,
        createdDirectories: [],
        atomic: writeCapabilities.atomic,
      },
    };
  };

  return { stat, write, stage, remove };
}
