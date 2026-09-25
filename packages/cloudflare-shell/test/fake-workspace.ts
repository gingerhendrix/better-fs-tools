import type { ShellFileInfo, ShellWorkspaceLike } from "../src/index.ts";
import { shellWorkspaceFileSystem } from "../src/index.ts";

const ENCODER = new TextEncoder();

export const ROOT = "/workspace";

interface Entry {
  type: "file" | "directory" | "symlink";
  bytes?: Uint8Array;
  target?: string;
  updatedAt: number;
  mimeType?: string;
}

export interface FakeWorkspace extends ShellWorkspaceLike {
  calls: string[];
  entries: Map<string, Entry>;
  put(path: string, contents: string | Uint8Array, mimeType?: string): void;
  link(path: string, target: string): void;
  /** Replaces one method for a single failure or malformed-result case. */
  override: Partial<Record<"stat" | "lstat" | "readFileBytes" | "readDir", unknown>>;
}

/**
 * An in-memory stand-in for a Shell Workspace: `stat` follows a trailing
 * symlink, `lstat` does not, `readFileBytes` buffers, `readDir` honours its
 * limit. Directories are created implicitly, as Shell's `ensureParentDir` does.
 */
export function fakeWorkspace(files: Record<string, string | Uint8Array> = {}): FakeWorkspace {
  const entries = new Map<string, Entry>([["/", { type: "directory", updatedAt: 1 }]]);
  const calls: string[] = [];
  const override: FakeWorkspace["override"] = {};

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
      updatedAt: (entries.get(path)?.updatedAt ?? 1_700_000_000_000) + 1,
      ...(mimeType === undefined ? {} : { mimeType }),
    });
  };
  const info = (path: string, entry: Entry): ShellFileInfo => ({
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
    async readDir(dir: string, opts?: { limit?: number; offset?: number }) {
      calls.push(`readDir:${dir}`);
      if (override.readDir !== undefined) return await run(override.readDir, dir);
      const found: ShellFileInfo[] = [];
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
  const fs = shellWorkspaceFileSystem(workspace, {
    root: ROOT,
    ...(maxBufferedBytes === undefined ? {} : { maxBufferedBytes }),
  });
  return { workspace, fs };
}
