import type { CloudflareShellFileInfo, CloudflareShellWorkspaceLike } from "../src/index.ts";
import { cloudflareShellFileSystem } from "../src/index.ts";

const ENCODER = new TextEncoder();

export const ROOT = "/workspace";

interface Entry {
  type: "file" | "directory" | "symlink";
  bytes?: Uint8Array;
  target?: string;
  updatedAt: number;
  mimeType?: string;
}

/** Every write method is present in the fake, so the tests can call them. */
export interface FakeWorkspace extends Required<CloudflareShellWorkspaceLike> {
  calls: string[];
  entries: Map<string, Entry>;
  put(path: string, contents: string | Uint8Array, mimeType?: string): void;
  link(path: string, target: string): void;
  /** Replaces one method for a single failure or malformed-result case. */
  override: Partial<Record<FakeMethod, unknown>>;
}

type FakeMethod =
  | "stat"
  | "lstat"
  | "readFileBytes"
  | "readDir"
  | "writeFileBytes"
  | "mkdir"
  | "rm";

/** Shell throws plain errors whose message starts with the POSIX code. */
function shellError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

/**
 * An in-memory stand-in for a Shell Workspace: `stat` follows a trailing
 * symlink, `lstat` does not, `readFileBytes` buffers, `readDir` honours its
 * limit. Directories are created implicitly, as Shell's `ensureParentDir` does.
 *
 * The write methods follow `@cloudflare/shell` 0.4.3: `writeFileBytes`
 * follows a leaf symlink, creates missing parents, and sets the mime type to
 * `application/octet-stream` unless one is passed. `mkdir` and `rm` throw
 * `EEXIST`, `ENOENT`, `ENOTDIR` and `ENOTEMPTY` as message prefixes, with no
 * `code` property. Each change moves `updatedAt` on. Real Shell stores whole
 * seconds, so two writes inside one second can keep the same `updatedAt`.
 */
export function fakeWorkspace(files: Record<string, string | Uint8Array> = {}): FakeWorkspace {
  const entries = new Map<string, Entry>([["/", { type: "directory", updatedAt: 1 }]]);
  const calls: string[] = [];
  const override: FakeWorkspace["override"] = {};
  /* One clock for the whole workspace, so a removed and recreated file gets a new time. */
  let clock = 1_700_000_000_000;

  const parents = (path: string): void => {
    let parent = dirnamePosix(path);
    while (!entries.has(parent)) {
      entries.set(parent, { type: "directory", updatedAt: 1 });
      if (parent === "/") break;
      parent = dirnamePosix(parent);
    }
  };
  const put = (path: string, contents: string | Uint8Array, mimeType?: string): void => {
    parents(path);
    const bytes = typeof contents === "string" ? ENCODER.encode(contents) : contents;
    entries.set(path, {
      type: "file",
      bytes,
      updatedAt: (clock += 1),
      ...(mimeType === undefined ? {} : { mimeType }),
    });
  };
  const info = (path: string, entry: Entry): CloudflareShellFileInfo => ({
    path,
    type: entry.type,
    size: entry.bytes?.byteLength ?? 0,
    updatedAt: entry.updatedAt,
    ...(entry.mimeType === undefined ? {} : { mimeType: entry.mimeType }),
    ...(entry.target === undefined ? {} : { target: entry.target }),
  });
  const follow = (path: string, depth = 0): string | null => {
    const entry = entries.get(path);
    if (entry === undefined) return null;
    if (entry.type !== "symlink" || depth > 8) return path;
    return follow(entry.target ?? "/", depth + 1);
  };

  const workspace: FakeWorkspace = {
    calls,
    entries,
    put,
    override,
    link(path: string, target: string) {
      parents(path);
      entries.set(path, { type: "symlink", target, updatedAt: 1 });
    },
    async stat(path: string) {
      calls.push(`stat:${path}`);
      if (override.stat !== undefined) return await run(override.stat, path);
      const followed = follow(path);
      const entry = followed === null ? undefined : entries.get(followed);
      return entry === undefined || followed === null ? null : info(followed, entry);
    },
    async lstat(path: string) {
      calls.push(`lstat:${path}`);
      if (override.lstat !== undefined) return await run(override.lstat, path);
      const entry = entries.get(path);
      return entry === undefined ? null : info(path, entry);
    },
    async readFileBytes(path: string) {
      calls.push(`readFileBytes:${path}`);
      if (override.readFileBytes !== undefined) return await run(override.readFileBytes, path);
      return entries.get(path)?.bytes ?? null;
    },
    async writeFileBytes(path: string, data: Uint8Array, mimeType?: string) {
      calls.push(`writeFileBytes:${path}`);
      if (override.writeFileBytes !== undefined) return await run(override.writeFileBytes, path);
      const target = follow(path) ?? path;
      if (target === "/" || entries.get(target)?.type === "directory") {
        throw shellError("EISDIR", `${path} is a directory`);
      }
      put(target, Uint8Array.from(data), mimeType ?? "application/octet-stream");
    },
    async mkdir(path: string, opts?: { recursive?: boolean }) {
      calls.push(`mkdir:${path}`);
      if (override.mkdir !== undefined) return await run(override.mkdir, path);
      if (path === "/") return;
      const existing = entries.get(path);
      if (existing !== undefined) {
        if (existing.type === "directory" && opts?.recursive === true) return;
        throw shellError("EEXIST", `path exists: ${path}`);
      }
      const parent = entries.get(dirnamePosix(path));
      if (parent === undefined) {
        if (opts?.recursive !== true) throw shellError("ENOENT", "parent directory not found");
        await workspace.mkdir(dirnamePosix(path), { recursive: true });
      } else if (parent.type !== "directory") {
        throw shellError("ENOTDIR", "parent is not a directory");
      }
      entries.set(path, { type: "directory", updatedAt: (clock += 1) });
    },
    async rm(path: string, opts?: { recursive?: boolean; force?: boolean }) {
      calls.push(`rm:${path}`);
      if (override.rm !== undefined) return await run(override.rm, path);
      if (path === "/") throw shellError("EPERM", "cannot remove root directory");
      const existing = entries.get(path);
      if (existing === undefined) {
        if (opts?.force === true) return;
        throw shellError("ENOENT", `no such file or directory: ${path}`);
      }
      const children = [...entries.keys()].filter((key) => key.startsWith(`${path}/`));
      if (existing.type === "directory" && children.length > 0) {
        if (opts?.recursive !== true) throw shellError("ENOTEMPTY", `directory not empty: ${path}`);
        for (const child of children) entries.delete(child);
      }
      entries.delete(path);
    },
    async readDir(dir: string, opts?: { limit?: number; offset?: number }) {
      calls.push(`readDir:${dir}`);
      if (override.readDir !== undefined) return await run(override.readDir, dir);
      const found: CloudflareShellFileInfo[] = [];
      for (const [path, entry] of entries) {
        if (path !== "/" && dirnamePosix(path) === dir) found.push(info(path, entry));
      }
      found.sort((left, right) => (left.path < right.path ? -1 : 1));
      const offset = opts?.offset ?? 0;
      return found.slice(offset, opts?.limit === undefined ? undefined : offset + opts.limit);
    },
  };

  for (const [path, contents] of Object.entries(files)) put(path, contents);
  return workspace;
}

// oxlint-disable-next-line typescript/no-explicit-any -- test override shim
async function run(value: unknown, path: string): Promise<any> {
  return typeof value === "function" ? await (value as (path: string) => unknown)(path) : value;
}

function dirnamePosix(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

export function fsFor(files: Record<string, string | Uint8Array> = {}, maxBufferedBytes?: number) {
  const workspace = fakeWorkspace(files);
  /* The root exists even when no file is in it. */
  if (!workspace.entries.has(ROOT))
    workspace.entries.set(ROOT, { type: "directory", updatedAt: 1 });
  const fs = cloudflareShellFileSystem(workspace, {
    allowedRoots: [ROOT],
    ...(maxBufferedBytes === undefined ? {} : { maxBufferedBytes }),
  });
  return { workspace, fs };
}
