import type {
  DirectoryEntry,
  FileSystem,
  FileSystemError,
  ListOptions,
  ListOutcome,
  OpenFile,
  OpenOptions,
  OpenOutcome,
  VerifyOutcome,
} from "./contract.ts";
import { containsPosix, posixPaths, resolvePosix } from "./paths.ts";

const ENCODER = new TextEncoder();

export interface MemoryFileSystemOptions {
  /** Seed contents keyed by absolute POSIX path. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  readonly directories?: readonly string[];
  /** Refused as dangerous-path. */
  readonly denyRoots?: readonly string[];
  /** Bytes per chunk. Default 64 KiB. */
  readonly chunkBytes?: number;
  /** Refused as denied above this. Default 16 MiB. */
  readonly maxBufferedBytes?: number;
  /** Default true. */
  readonly streaming?: boolean;
  /** Default true. */
  readonly identity?: boolean;
  /** Default true. false removes list(). */
  readonly list?: boolean;
  readonly id?: string;
}

export interface MemoryFileSystem extends FileSystem {
  write(path: string, contents: string | Uint8Array): void;
  remove(path: string): void;
  makeDirectory(path: string): void;
  setMimeType(path: string, value: string | null): void;
}

interface Entry {
  bytes: Uint8Array;
  generation: number;
  mimeType: string | null;
}

/** An in-memory filesystem for tests and for embedding. */
export function memoryFileSystem(options: MemoryFileSystemOptions = {}): MemoryFileSystem {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const maxBufferedBytes = options.maxBufferedBytes ?? 16 * 1024 * 1024;
  const streaming = options.streaming ?? true;
  const identityCapability = options.identity ?? true;
  const denyRoots = (options.denyRoots ?? []).map((root) => resolvePosix("/", root));
  const files = new Map<string, Entry>();
  const directories = new Set<string>([
    "/",
    ...(options.directories ?? []).map((path) => resolvePosix("/", path)),
  ]);
  let generation = 0;

  const write = (path: string, contents: string | Uint8Array): void => {
    const absolute = resolvePosix("/", path);
    generation += 1;
    files.set(absolute, {
      bytes: typeof contents === "string" ? ENCODER.encode(contents) : contents,
      generation,
      mimeType: files.get(absolute)?.mimeType ?? null,
    });
    let parent = posixPaths.dirname(absolute);
    while (parent !== "/" && !directories.has(parent)) {
      directories.add(parent);
      parent = posixPaths.dirname(parent);
    }
  };

  for (const [path, contents] of Object.entries(options.files ?? {})) write(path, contents);

  const fail = (error: FileSystemError): OpenOutcome => ({ ok: false, error });

  const open = async (path: string, callOptions: OpenOptions = {}): Promise<OpenOutcome> => {
    if (callOptions.signal?.aborted) return fail({ reason: "aborted" });
    const absolute = resolvePosix("/", path);
    const denied = denyRoots.find((root) => containsPosix(root, absolute));
    if (denied !== undefined) return fail({ reason: "dangerous-path", detail: denied });
    if (directories.has(absolute) && !files.has(absolute)) {
      return fail({
        reason: "not-a-file",
        kind: "directory",
        target: { resolvedPath: absolute, displayPath: absolute },
      });
    }
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
        identity: identityCapability ? `memory:${absolute}:${openedGeneration}` : null,
        mimeType: entry.mimeType,
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
    paths: posixPaths,
    write,
    remove(path: string) {
      generation += 1;
      files.delete(resolvePosix("/", path));
    },
    makeDirectory(path: string) {
      directories.add(resolvePosix("/", path));
    },
    setMimeType(path: string, value: string | null) {
      const entry = files.get(resolvePosix("/", path));
      if (entry !== undefined) entry.mimeType = value;
    },
    open,
    ...(options.list === false ? {} : { list }),
  });
}
