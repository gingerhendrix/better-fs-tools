import path from "node:path";

import { nodeFileSystem } from "@better-fs-tools/node";
import type { NodeFileSystem, NodeFileSystemOptions } from "@better-fs-tools/node";
import type { ToolCallContext } from "@better-fs-tools/read";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const MAX_CACHED_ROOTS = 8;

const ROOT_WIDENING_OPTIONS = ["fs", "cwd", "allowedRoots"] as const;

/** Filesystem options for a Pi tool. The root is always ctx.cwd. */
export interface PiRootOptions {
  /** Added to /dev, /proc, /sys. */
  readonly denyRoots?: readonly string[];
  readonly symlinks?: NodeFileSystemOptions["symlinks"];
  /** How to replace a file with more than one hard link. Default "in-place". "refuse" fails with DENIED. */
  readonly hardLinks?: "refuse" | "in-place";
  /** Mode of a new file, exactly. Default 0o666 less the process umask. */
  readonly newFileMode?: number;
  /** Mode of a directory that createParents makes, exactly. Default 0o777 less the umask. */
  readonly newDirectoryMode?: number;
}

export const PI_ROOT_KEYS = [
  "denyRoots",
  "symlinks",
  "hardLinks",
  "newFileMode",
  "newDirectoryMode",
] as const satisfies readonly (keyof PiRootOptions)[];

export type PiFileSystems = (call: ToolCallContext<ExtensionContext>) => NodeFileSystem;

export function checkPiOptions(options: unknown, tool: string): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`Pi ${tool} tool options must be an object`);
  }
  for (const key of ROOT_WIDENING_OPTIONS) {
    if (Object.hasOwn(options, key)) {
      throw new TypeError(
        `Pi ${tool} tool options cannot set ${key}: the root is bound to ctx.cwd on every call`,
      );
    }
  }
}

export function checkPiContext(ctx: unknown, tool: string): void {
  if (
    ctx === null ||
    typeof ctx !== "object" ||
    typeof (ctx as { cwd?: unknown }).cwd !== "string" ||
    (ctx as { cwd: string }).cwd.length === 0
  ) {
    throw new TypeError(`Pi ${tool} execution requires ctx.cwd`);
  }
}

export function piFileSystems(options: PiRootOptions): PiFileSystems {
  const { denyRoots, symlinks, hardLinks, newFileMode, newDirectoryMode } = options;
  const fileSystemFor = rootCache((root) =>
    nodeFileSystem({
      cwd: root,
      allowedRoots: [root],
      ...(denyRoots === undefined ? {} : { denyRoots }),
      ...(symlinks === undefined ? {} : { symlinks }),
      ...(hardLinks === undefined ? {} : { hardLinks }),
      ...(newFileMode === undefined ? {} : { newFileMode }),
      ...(newDirectoryMode === undefined ? {} : { newDirectoryMode }),
    }),
  );
  return (call) => fileSystemFor(path.resolve(call.host.cwd));
}

function rootCache(build: (root: string) => NodeFileSystem): (root: string) => NodeFileSystem {
  const cache = new Map<string, NodeFileSystem>();
  return (root) => {
    const cached = cache.get(root);
    if (cached !== undefined) return cached;
    const fs = build(root);
    if (cache.size >= MAX_CACHED_ROOTS) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(root, fs);
    return fs;
  };
}
