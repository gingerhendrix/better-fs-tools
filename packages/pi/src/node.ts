/**
 * The `./node` subpath: Node backends for a Pi tool, rooted at each call's
 * ctx.cwd. Pass `fs: piCwdFileSystem()` to a Pi file tool, and
 * `runner: piCwdCommandRunner()` to createPiBashTool(). The main entry does
 * not import Node.
 */
import path from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { nodeCommandRunner, nodeFileSystem } from "@better-fs-tools/node";
import type {
  NodeCommandRunnerOptions,
  NodeFileSystem,
  NodeFileSystemOptions,
} from "@better-fs-tools/node";
import type { ToolCallContext } from "@better-fs-tools/read";
import type { CommandRunner } from "@better-fs-tools/shell";

const MAX_CACHED = 8;

/** The options of nodeFileSystem() without `cwd` and `allowedRoots`: the root is always ctx.cwd. */
export type PiCwdFileSystemOptions = Omit<NodeFileSystemOptions, "cwd" | "allowedRoots">;

/** The options of nodeCommandRunner() without `cwd`: commands run in ctx.cwd. */
export type PiCwdCommandRunnerOptions = Omit<NodeCommandRunnerOptions, "cwd">;

/** A factory of the call, as the `fs` and `runner` options of a tool take. */
export type PiCallFactory<T> = (call: ToolCallContext<ExtensionContext>) => T;

/**
 * A per-call filesystem: nodeFileSystem() with `cwd` and `allowedRoots` set to
 * the call's ctx.cwd. It keeps the filesystems of the last 8 roots. The
 * factory throws TypeError when ctx.cwd is missing or empty, and when
 * `options` sets `cwd` or `allowedRoots`.
 */
export function piCwdFileSystem(
  options: PiCwdFileSystemOptions = {},
): PiCallFactory<NodeFileSystem> {
  checkOptions(options, "piCwdFileSystem", ["cwd", "allowedRoots"]);
  const cache = new Map<string, NodeFileSystem>();
  return (call) => {
    const root = path.resolve(cwdOf(call, "piCwdFileSystem"));
    const cached = cache.get(root);
    if (cached !== undefined) return cached;
    const fs = nodeFileSystem({ ...options, cwd: root, allowedRoots: [root] });
    if (cache.size >= MAX_CACHED) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(root, fs);
    return fs;
  };
}

/**
 * A per-call runner: nodeCommandRunner() at the call's ctx.cwd. It keeps the
 * runners of the last 8 directories used. The factory throws TypeError when
 * ctx.cwd is not an absolute path, and when `options` sets `cwd`.
 */
export function piCwdCommandRunner(
  options: PiCwdCommandRunnerOptions = {},
): PiCallFactory<CommandRunner> {
  checkOptions(options, "piCwdCommandRunner", ["cwd"]);
  const cache = new Map<string, CommandRunner>();
  return (call) => {
    const cwd = cwdOf(call, "piCwdCommandRunner");
    if (!path.isAbsolute(cwd)) {
      throw new TypeError("piCwdCommandRunner needs an absolute ctx.cwd");
    }
    const cached = cache.get(cwd);
    if (cached !== undefined) {
      cache.delete(cwd);
      cache.set(cwd, cached);
      return cached;
    }
    const made = nodeCommandRunner({ ...options, cwd });
    cache.set(cwd, made);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
    return made;
  };
}

function cwdOf(call: ToolCallContext<ExtensionContext>, label: string): string {
  const cwd: unknown = (call?.host as { cwd?: unknown } | undefined)?.cwd;
  if (typeof cwd !== "string" || cwd === "") {
    throw new TypeError(`${label} needs ctx.cwd: pass the Pi extension context as the host`);
  }
  return cwd;
}

function checkOptions(options: unknown, label: string, refused: readonly string[]): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${label} options must be an object`);
  }
  for (const key of refused) {
    if (Object.hasOwn(options, key)) {
      throw new TypeError(`${label} options cannot set ${key}: the root is ctx.cwd on every call`);
    }
  }
}
