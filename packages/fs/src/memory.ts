import type {
  DirectoryEntry,
  FileSystemError,
  ListOptions,
  ListOutcome,
  OpenFile,
  OpenOptions,
  OpenOutcome,
  VerifyOutcome,
} from "./contract.ts";
import { containsPosix, posixPaths, resolvePosix } from "./paths.ts";
import { DEFAULT_MODE, memoryWrites } from "./memory-write.ts";
import type { MemoryEntry, MemoryFaults, MemoryState } from "./memory-write.ts";
import type { WritableFileSystem, WriteCapabilities } from "./writable.ts";

const ENCODER = new TextEncoder();

export interface MemoryFileSystemOptions {
  /** Seed contents keyed by absolute POSIX path. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  readonly directories?: readonly string[];
  /** Refused as dangerous-path. */
  readonly denyRoots?: readonly string[];
  /** Bytes per chunk. Default 64 KiB. */
  readonly chunkBytes?: number;
  /** Refused as denied above this on open, and as no-space on write. Default 16 MiB. */
  readonly maxBufferedBytes?: number;
  /** Default true. */
  readonly streaming?: boolean;
  /** Default true. */
  readonly identity?: boolean;
  /** Default true. false removes list(). */
  readonly list?: boolean;
  readonly id?: string;
  /**
   * Default { atomic: true, compareAndSwap: true, preserveMode: true }.
   * preserveMode: false resets the mode on a replace. The other two are reported only.
   */
  readonly writeCapabilities?: Partial<WriteCapabilities>;
  /** Default true. false removes stage(). */
  readonly stage?: boolean;
  /** Default true. false removes remove(). */
  readonly remove?: boolean;
  /** Every mutation gives reason "read-only". Default false. */
  readonly readOnly?: boolean;
  /** Test hook. A non-null return fails that operation with the error. */
  readonly faults?: MemoryFaults;
}

/** The test helpers are named setFile and deleteFile so write() and remove() can be the contract methods. */
export interface MemoryFileSystem extends WritableFileSystem {
  /** Test helper. Sets the bytes and bumps the version. Creates parents. Keeps the mode of an existing file, else 0o644. */
  setFile(path: string, contents: string | Uint8Array, options?: { readonly mode?: number }): void;
  /** Test helper. Removes the file and bumps the generation. */
  deleteFile(path: string): void;
  makeDirectory(path: string): void;
  setMimeType(path: string, value: string | null): void;
  /** Current bytes, mode, and version, or null. For assertions. */
  peek(
    path: string,
  ): { readonly bytes: Uint8Array; readonly mode: number; readonly version: string } | null;
}

/** An in-memory filesystem for tests and for embedding. */
export function memoryFileSystem(options: MemoryFileSystemOptions = {}): MemoryFileSystem {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const maxBufferedBytes = options.maxBufferedBytes ?? 16 * 1024 * 1024;
  const streaming = options.streaming ?? true;
  const identityCapability = options.identity ?? true;
  const writeCapabilities: WriteCapabilities = Object.freeze({
    atomic: true,
    compareAndSwap: true,
    preserveMode: true,
    ...options.writeCapabilities,
  });
  const denyRoots = (options.denyRoots ?? []).map((root) => resolvePosix("/", root));
  const files = new Map<string, MemoryEntry>();
  const directories = new Set<string>([
    "/",
    ...(options.directories ?? []).map((path) => resolvePosix("/", path)),
  ]);
  let generation = 0;

  // The version is the identity string, also without the identity capability.
  const versionOf = (absolute: string, entry: MemoryEntry): string =>
    `memory:${absolute}:${entry.generation}`;

  const put = (absolute: string, bytes: Uint8Array, mode: number | undefined): MemoryEntry => {
    const previous = files.get(absolute);
    generation += 1;
    const entry: MemoryEntry = {
      bytes,
      generation,
      mimeType: previous?.mimeType ?? null,
      mode: mode ?? previous?.mode ?? DEFAULT_MODE,
    };
    files.set(absolute, entry);
    return entry;
  };

  const setFile = (
    path: string,
    contents: string | Uint8Array,
    fileOptions: { readonly mode?: number } = {},
  ): void => {
    const absolute = resolvePosix("/", path);
    put(
      absolute,
      typeof contents === "string" ? ENCODER.encode(contents) : contents,
      fileOptions.mode,
    );
    let parent = posixPaths.dirname(absolute);
    while (parent !== "/" && !directories.has(parent)) {
      directories.add(parent);
      parent = posixPaths.dirname(parent);
    }
  };

  for (const [path, contents] of Object.entries(options.files ?? {})) setFile(path, contents);

  const fail = (error: FileSystemError): OpenOutcome => ({ ok: false, error });

  /** The access decision open, stat, and every mutation share: abort, deny roots, type. */
  const gate = (absolute: string, signal: AbortSignal | undefined): FileSystemError | null => {
    if (signal?.aborted) return { reason: "aborted" };
    const denied = denyRoots.find((root) => containsPosix(root, absolute));
    if (denied !== undefined) return { reason: "dangerous-path", detail: denied };
    if (directories.has(absolute) && !files.has(absolute)) {
      return {
        reason: "not-a-file",
        kind: "directory",
        target: { resolvedPath: absolute, displayPath: absolute },
      };
    }
    return null;
  };

  const open = async (path: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> => {
    const absolute = resolvePosix("/", path);
    const refused = gate(absolute, callOptions.signal);
    if (refused !== null) return fail(refused);
    const entry = files.get(absolute);
    if (entry === undefined) return fail({ reason: "not-found" });
    if (entry.bytes.byteLength > maxBufferedBytes) {
      return fail({
        reason: "denied",
        detail: `object exceeds the ${maxBufferedBytes}-byte buffered ceiling`,
      });
    }
    const openedGeneration = entry.generation;
    let consumed = false;
    const file: OpenFile = {
      info: {
        resolvedPath: absolute,
        displayPath: absolute,
        size: entry.bytes.byteLength,
        mtimeMs: null,
        identity: identityCapability ? versionOf(absolute, entry) : null,
        mimeType: entry.mimeType,
        version: versionOf(absolute, entry),
      },
      bytes(): AsyncIterable<Uint8Array> {
        if (consumed) throw new TypeError("memory byte source is single-use");
        consumed = true;
        const size = streaming ? chunkBytes : entry.bytes.byteLength || 1;
        return (async function* iterate() {
          for (let offset = 0; offset < entry.bytes.byteLength; offset += size) {
            yield entry.bytes.subarray(offset, Math.min(offset + size, entry.bytes.byteLength));
          }
        })();
      },
      async verify(): Promise<VerifyOutcome> {
        const current = files.get(absolute);
        if (current === undefined) return { ok: true, changed: true };
        return { ok: true, changed: current.generation !== openedGeneration };
      },
      async close() {
        consumed = true;
      },
    };
    return { ok: true, file };
  };

  const state: MemoryState = {
    files,
    directories,
    identity: identityCapability,
    maxBufferedBytes,
    gate,
    versionOf,
    put,
    drop(absolute) {
      generation += 1;
      files.delete(absolute);
    },
  };
  const { stat, write, stage, remove } = memoryWrites(state, {
    writeCapabilities,
    readOnly: options.readOnly ?? false,
    faults: options.faults ?? (() => null),
  });

  const list = async (path: string, listOptions: ListOptions): Promise<ListOutcome> => {
    if (listOptions.signal?.aborted) return { ok: false, error: { reason: "aborted" } };
    const absolute = resolvePosix("/", path);
    if (!directories.has(absolute)) {
      const detail = files.has(absolute) ? "not a directory" : undefined;
      return {
        ok: false,
        error: detail === undefined ? { reason: "not-found" } : { reason: "not-found", detail },
      };
    }
    const entries: DirectoryEntry[] = [];
    let truncated = false;
    const push = (name: string, type: DirectoryEntry["type"]): boolean => {
      if (entries.length >= listOptions.limit) {
        truncated = true;
        return false;
      }
      entries.push({ name, type });
      return true;
    };
    for (const key of files.keys()) {
      if (posixPaths.dirname(key) !== absolute) continue;
      if (!push(posixPaths.basename(key), "file")) break;
    }
    if (!truncated) {
      for (const directory of directories) {
        if (directory === absolute || posixPaths.dirname(directory) !== absolute) continue;
        if (!push(posixPaths.basename(directory), "directory")) break;
      }
    }
    return { ok: true, entries, truncated };
  };

  return Object.freeze({
    id: options.id ?? "memory",
    capabilities: Object.freeze({ streaming, identity: identityCapability }),
    writeCapabilities,
    paths: posixPaths,
    setFile,
    deleteFile(path: string) {
      state.drop(resolvePosix("/", path));
    },
    makeDirectory(path: string) {
      directories.add(resolvePosix("/", path));
    },
    setMimeType(path: string, value: string | null) {
      const entry = files.get(resolvePosix("/", path));
      if (entry !== undefined) entry.mimeType = value;
    },
    peek(path: string) {
      const absolute = resolvePosix("/", path);
      const entry = files.get(absolute);
      if (entry === undefined) return null;
      return {
        bytes: Uint8Array.from(entry.bytes),
        mode: entry.mode,
        version: versionOf(absolute, entry),
      };
    },
    open,
    stat,
    write,
    ...(options.stage === false ? {} : { stage }),
    ...(options.remove === false ? {} : { remove }),
    ...(options.list === false ? {} : { list }),
  });
}
