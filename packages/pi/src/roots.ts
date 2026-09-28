import path from "node:path";

import { nodeFileSystem } from "@better-fs-tools/node";
import type { NodeFileSystem } from "@better-fs-tools/node";
import type { ToolCallContext } from "@better-fs-tools/read";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Distinct working directories whose filesystems are kept (D19). */
const MAX_CACHED_ROOTS = 8;

/** Options that would widen the root. The root is always the call's ctx.cwd (D5). */
const FORBIDDEN_OPTIONS = ["fs", "cwd", "allowedRoots"] as const;

/** The filesystem policy a Pi tool may set. The root is not one of them. */
export interface PiRootOptions {
  /** Added to /dev, /proc, /sys. */
  readonly denyRoots?: readonly string[];
  readonly symlinks?: "follow-within-roots" | "reject";
  /** A replace of a file with more than one hard link. Default "refuse" (W12). */
  readonly hardLinks?: "refuse" | "in-place";
}

/** The fs factory every Pi tool uses: one Node filesystem for each ctx.cwd. */
export type PiFileSystems = (call: ToolCallContext<ExtensionContext>) => NodeFileSystem;

/** Throws TypeError when options are not an object, or set fs, cwd, or allowedRoots (D5). */
export function checkPiOptions(options: unknown, tool: string): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`Pi ${tool} tool options must be an object`);
  }
  for (const key of FORBIDDEN_OPTIONS) {
    if (Object.hasOwn(options, key)) {
      throw new TypeError(
        `Pi ${tool} tool options cannot set ${key}: the root is bound to ctx.cwd on every call`,
      );
    }
  }
}

/** Throws TypeError unless ctx is an object with a non-empty cwd. */
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

/**
 * A factory over ctx.cwd with an 8-root cache (D19). Each root gets
 * nodeFileSystem({ cwd: root, allowedRoots: [root] }) and the given policy.
 */
export function piFileSystems(options: PiRootOptions): PiFileSystems {
  const { denyRoots, symlinks, hardLinks } = options;
  const fileSystemFor = rootCache((root) =>
    nodeFileSystem({
      cwd: root,
      allowedRoots: [root],
      ...(denyRoots === undefined ? {} : { denyRoots }),
      ...(symlinks === undefined ? {} : { symlinks }),
      ...(hardLinks === undefined ? {} : { hardLinks }),
    }),
  );
  return (call) => fileSystemFor(path.resolve(call.host.cwd));
}

/**
 * One filesystem for each resolved root, at most MAX_CACHED_ROOTS. The oldest
 * insertion goes first. An evicted root is rebuilt on its next call.
 */
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
