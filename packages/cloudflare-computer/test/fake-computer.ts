import { cloudflareComputerFileSystem } from "../src/index.ts";
import type {
  CloudflareComputerDirent,
  CloudflareComputerFileSystemLike,
  CloudflareComputerStat,
} from "../src/index.ts";

const ENCODER = new TextEncoder();

export const ROOT = "/workspace";

interface Entry {
  type: "file" | "directory" | "symlink";
  bytes?: Uint8Array;
  target?: string;
  mtime: number;
  mode?: number;
}

export interface FakeComputer extends Required<CloudflareComputerFileSystemLike> {
  calls: string[];
  readFileArity: number[];
  cancelled: string[];
  entries: Map<string, Entry>;
  chunkSize: number;
  unoverridden: Pick<CloudflareComputerFileSystemLike, "stat" | "lstat" | "readFile" | "readdir">;
  put(path: string, contents: string | Uint8Array): void;
  link(path: string, target: string): void;
  override: Partial<Record<FakeMethod, unknown>>;
}

type FakeMethod = "stat" | "lstat" | "readFile" | "readdir" | "writeFile" | "mkdir" | "rm";

/* Mimics `@cloudflare/computer` 0.2.1: a miss throws `ENOENT`, `writeFile` resets the mode. */
export function fakeComputer(files: Record<string, string | Uint8Array> = {}): FakeComputer {
  const entries = new Map<string, Entry>([["/", { type: "directory", mtime: 1 }]]);
  const calls: string[] = [];
  const readFileArity: number[] = [];
  const cancelled: string[] = [];
  const override: FakeComputer["override"] = {};
  let clock = 1_700_000_000_000;

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
      mtime: (clock += 1),
      mode: entries.get(path)?.mode ?? 0o644,
    });
  };
  const stat = (path: string, entry: Entry): CloudflareComputerStat => ({
    name: path === "/" ? "/" : basenamePosix(path),
    size: entry.bytes?.byteLength ?? 0,
    mtime: entry.mtime,
    isFile: entry.type === "file",
    isDirectory: entry.type === "directory",
    isSymbolicLink: entry.type === "symlink",
    mode: entry.mode ?? (entry.type === "directory" ? 0o755 : 0o777),
  });
  const follow = (path: string, depth = 0): string => {
    const entry = entries.get(path);
    if (entry === undefined) throw fsError("ENOENT", `no such path: ${path}`);
    if (entry.type !== "symlink") return path;
    if (depth > 8) throw fsError("ELOOP", `too many symbolic links: ${path}`);
    return follow(entry.target ?? "/", depth + 1);
  };

  async function rawStat(path: string): Promise<CloudflareComputerStat> {
    const followed = follow(path);
    const entry = entries.get(followed);
    if (entry === undefined) throw fsError("ENOENT", `no such path: ${path}`);
    return { ...stat(followed, entry), name: path === "/" ? "/" : basenamePosix(path) };
  }

  async function rawLstat(path: string): Promise<CloudflareComputerStat> {
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
  ): Promise<CloudflareComputerDirent[]> {
    const found: CloudflareComputerDirent[] = [];
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
    unoverridden: {
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
    async writeFile(
      path: string,
      content: Uint8Array,
      options?: { mode?: number; exclusive?: boolean },
    ) {
      calls.push(`writeFile:${path}`);
      if (override.writeFile !== undefined) return await run(override.writeFile, path);
      if (entries.get(dirnamePosix(path))?.type !== "directory") {
        throw fsError("ENOENT", `parent directory missing: ${path}`);
      }
      if (entries.has(path) && options?.exclusive === true) {
        throw fsError("EEXIST", `path exists: ${path}`);
      }
      const target = entries.has(path) ? follow(path) : path;
      if (entries.get(target)?.type === "directory") {
        throw fsError("EISDIR", `path is a directory: ${path}`);
      }
      entries.set(target, {
        type: "file",
        bytes: Uint8Array.from(content),
        mtime: (clock += 1),
        mode: (options?.mode ?? 0o644) & 0o7777,
      });
    },
    async mkdir(path: string, options?: { recursive?: boolean; mode?: number }) {
      calls.push(`mkdir:${path}`);
      if (override.mkdir !== undefined) return await run(override.mkdir, path);
      const existing = entries.get(path);
      if (existing !== undefined) {
        if (existing.type === "directory" && options?.recursive === true) return;
        throw fsError("EEXIST", `path exists: ${path}`);
      }
      const parent = entries.get(dirnamePosix(path));
      if (parent === undefined) {
        if (options?.recursive !== true) throw fsError("ENOENT", `parent directory missing`);
        await fake.mkdir(dirnamePosix(path), { recursive: true });
      } else if (parent.type !== "directory") {
        throw fsError("ENOTDIR", "parent path segment is not a directory");
      }
      entries.set(path, { type: "directory", mtime: (clock += 1), mode: options?.mode ?? 0o755 });
    },
    async rm(path: string, options?: { recursive?: boolean; force?: boolean }) {
      calls.push(`rm:${path}`);
      if (override.rm !== undefined) return await run(override.rm, path);
      if (path === "/") throw fsError("EPERM", "cannot remove the root directory");
      const existing = entries.get(path);
      if (existing === undefined) {
        if (options?.force === true) return;
        throw fsError("ENOENT", `no such path: ${path}`);
      }
      const children = [...entries.keys()].filter((key) => key.startsWith(`${path}/`));
      if (existing.type === "directory" && children.length > 0) {
        if (options?.recursive !== true) throw fsError("ENOTEMPTY", `directory not empty: ${path}`);
        for (const child of children) entries.delete(child);
      }
      entries.delete(path);
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
  if (!backend.entries.has(ROOT)) backend.entries.set(ROOT, { type: "directory", mtime: 1 });
  return { backend, fs: cloudflareComputerFileSystem(backend, { allowedRoots: [ROOT] }) };
}
