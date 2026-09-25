import { computerFileSystem } from "../src/index.ts";
import type { ComputerDirent, ComputerFileSystemLike, ComputerStat } from "../src/index.ts";

const ENCODER = new TextEncoder();

export const ROOT = "/workspace";

interface Entry {
  type: "file" | "directory" | "symlink";
  bytes?: Uint8Array;
  target?: string;
  mtime: number;
}

export interface FakeComputer extends ComputerFileSystemLike {
  calls: string[];
  /** Argument counts seen by `readFile`, so the overload choice is observable. */
  readFileArity: number[];
  /** Paths whose stream was cancelled, in order. */
  cancelled: string[];
  entries: Map<string, Entry>;
  chunkSize: number;
  /** The unoverridden implementations, so an override can be path-specific. */
  raw: Pick<ComputerFileSystemLike, "stat" | "lstat" | "readFile" | "readdir">;
  put(path: string, contents: string | Uint8Array): void;
  link(path: string, target: string): void;
  /** Replaces one method for a single failure or malformed-result case. */
  override: Partial<Record<"stat" | "lstat" | "readFile" | "readdir", unknown>>;
}

/**
 * An in-memory stand-in for Computer's `workspace.fs`: `stat` follows links and
 * raises `ELOOP` on a cycle, `lstat` does not follow, `readFile` returns a Web
 * stream in small chunks, and a miss throws a `WorkspaceFsError`-shaped
 * `ENOENT` rather than resolving null, exactly as `0.2.1` does.
 */
export function fakeComputer(files: Record<string, string | Uint8Array> = {}): FakeComputer {
  const entries = new Map<string, Entry>([["/", { type: "directory", mtime: 1 }]]);
  const calls: string[] = [];
  const readFileArity: number[] = [];
  const cancelled: string[] = [];
  const override: FakeComputer["override"] = {};

  const parents = (path: string): void => {
    let parent = dirnamePosix(path);
    while (!entries.has(parent)) {
      entries.set(parent, { type: "directory", mtime: 1 });
      if (parent === "/") break;
      parent = dirnamePosix(parent);
    }
  };
  const put = (path: string, contents: string | Uint8Array): void => {
    parents(path);
    const bytes = typeof contents === "string" ? ENCODER.encode(contents) : contents;
    entries.set(path, {
      type: "file",
      bytes,
      mtime: (entries.get(path)?.mtime ?? 1_700_000_000_000) + 1,
    });
  };
  const stat = (path: string, entry: Entry): ComputerStat => ({
    name: path === "/" ? "/" : basenamePosix(path),
    size: entry.bytes?.byteLength ?? 0,
    mtime: entry.mtime,
    isFile: entry.type === "file",
    isDirectory: entry.type === "directory",
    isSymbolicLink: entry.type === "symlink",
  });
  const follow = (path: string, depth = 0): string => {
    const entry = entries.get(path);
    if (entry === undefined) throw fsError("ENOENT", `no such path: ${path}`);
    if (entry.type !== "symlink") return path;
    if (depth > 8) throw fsError("ELOOP", `too many symbolic links: ${path}`);
    return follow(entry.target ?? "/", depth + 1);
  };

  async function rawStat(path: string): Promise<ComputerStat> {
    const followed = follow(path);
    const entry = entries.get(followed);
    if (entry === undefined) throw fsError("ENOENT", `no such path: ${path}`);
    return { ...stat(followed, entry), name: path === "/" ? "/" : basenamePosix(path) };
  }

  async function rawLstat(path: string): Promise<ComputerStat> {
    const entry = entries.get(path);
    if (entry === undefined) throw fsError("ENOENT", `no such path: ${path}`);
    return stat(path, entry);
  }

  async function rawReadFile(path: string): Promise<ReadableStream<Uint8Array>> {
    const entry = entries.get(path);
    if (entry === undefined || entry.bytes === undefined) {
      throw fsError("ENOENT", `no such file: ${path}`);
    }
    return streamOf(entry.bytes, path, cancelled, fake.chunkSize);
  }

  async function rawReaddir(
    dir: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ComputerDirent[]> {
    const found: ComputerDirent[] = [];
    for (const [path, entry] of entries) {
      if (path === "/" || dirnamePosix(path) !== dir) continue;
      found.push({
        name: basenamePosix(path),
        parentPath: dir,
        isFile: entry.type === "file",
        isDirectory: entry.type === "directory",
        isSymbolicLink: entry.type === "symlink",
      });
    }
    found.sort((left, right) => (left.name < right.name ? -1 : 1));
    const offset = options?.offset ?? 0;
    return found.slice(offset, options?.limit === undefined ? undefined : offset + options.limit);
  }

  const fake: FakeComputer = {
    calls,
    readFileArity,
    cancelled,
    entries,
    chunkSize: 8,
    put,
    override,
    link(path: string, target: string) {
      parents(path);
      entries.set(path, { type: "symlink", target, mtime: 1 });
    },
    raw: {
      stat: rawStat,
      lstat: rawLstat,
      readFile: rawReadFile,
      readdir: rawReaddir,
    },
    async stat(path: string) {
      calls.push(`stat:${path}`);
      if (override.stat !== undefined) return await run(override.stat, path);
      return await rawStat(path);
    },
    async lstat(path: string) {
      calls.push(`lstat:${path}`);
      if (override.lstat !== undefined) return await run(override.lstat, path);
      return await rawLstat(path);
    },
    async readFile(...args: unknown[]) {
      const path = String(args[0]);
      calls.push(`readFile:${path}`);
      readFileArity.push(args.length);
      if (override.readFile !== undefined) return await run(override.readFile, path);
      return await rawReadFile(path);
    },
    async readdir(dir: string, options?: { limit?: number; offset?: number }) {
      calls.push(`readdir:${dir}`);
      if (override.readdir !== undefined) return await run(override.readdir, dir);
      return await rawReaddir(dir, options);
    },
  };

  for (const [path, contents] of Object.entries(files)) put(path, contents);
  return fake;
}

// oxlint-disable-next-line typescript/no-explicit-any -- test override shim
async function run(value: unknown, path: string): Promise<any> {
  return typeof value === "function" ? await (value as (path: string) => unknown)(path) : value;
}

export function streamOf(
  bytes: Uint8Array,
  path: string,
  cancelled: string[],
  chunkSize: number,
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
    cancel() {
      cancelled.push(path);
    },
  });
}

export function fsError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = "WorkspaceFsError";
  return Object.assign(error, { code });
}

function dirnamePosix(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function basenamePosix(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function fsFor(files: Record<string, string | Uint8Array> = {}) {
  const backend = fakeComputer(files);
  return { backend, fs: computerFileSystem(backend, { root: ROOT }) };
}
