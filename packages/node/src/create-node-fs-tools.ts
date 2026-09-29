import path from "node:path";

import type { SymlinkPolicy } from "@better-fs-tools/fs";

import type {
  Clock,
  Digest,
  ReadStateStore,
  ReadTool,
  ReadToolDeps,
  ToolCallContext,
} from "@better-fs-tools/read";
import { createFsTools } from "@better-fs-tools/write";
import type {
  ApplyPatchTool,
  ApplyPatchToolDeps,
  EditTool,
  EditToolDeps,
  FsToolsSharedKey,
  InvalidateOutcome,
  LockManager,
  WriteTool,
  WriteToolDeps,
} from "@better-fs-tools/write";

import type { BashTool, ShellToolDeps } from "@better-fs-tools/shell";

import { withNodeShellDefaults } from "./create-node-bash-tool.ts";
import { nodeDigest } from "./digest.ts";
import { nodeFileSystem } from "./filesystem.ts";
import type { NodeFileSystem } from "./filesystem.ts";

const KNOWN_OPTIONS: ReadonlySet<string> = new Set([
  "cwd",
  "allowedRoots",
  "denyRoots",
  "symlinks",
  "hardLinks",
  "newFileMode",
  "newDirectoryMode",
  "state",
  "digest",
  "locks",
  "clock",
  "read",
  "edit",
  "write",
  "applyPatch",
  "bash",
]);

const BUNDLE_SHARED_KEYS_BY_TOOL = {
  read: ["fs", "state", "digest", "clock"],
  edit: ["fs", "state", "digest", "locks", "clock"],
  write: ["fs", "state", "digest", "locks", "clock"],
  applyPatch: ["fs", "state", "digest", "locks", "clock"],
  bash: ["digest", "clock"],
} as const;

/**
 * Options for the bundle's bash tool, all optional. `runner` defaults to
 * nodeCommandRunner({ cwd }), and `env` to shellEnv(() => process.env).
 */
export type NodeFsToolsBashOptions<THost = undefined> = Omit<
  Partial<ShellToolDeps<THost>>,
  "digest" | "clock"
>;

export interface CreateNodeFsToolsOptions<THost = undefined> {
  /** Default process.cwd(). */
  readonly cwd?: string;
  /** Default [cwd]. They do not limit a bash command. */
  readonly allowedRoots?: readonly string[];
  readonly denyRoots?: readonly string[];
  readonly symlinks?: SymlinkPolicy;
  readonly hardLinks?: "refuse" | "in-place";
  /** Mode of a new file, exactly. Default 0o666 less the process umask. */
  readonly newFileMode?: number;
  /** Mode of a directory that createParents makes, exactly. Default 0o777 less the umask. */
  readonly newDirectoryMode?: number;
  /** Default a memory store on the bundle clock. null turns read-before-write off. */
  readonly state?: ReadStateStore | null;
  /** Default nodeDigest(). */
  readonly digest?: Digest;
  /** Default memoryLocks(). */
  readonly locks?: LockManager;
  /** Default () => new Date(). */
  readonly clock?: Clock;
  readonly read?: Omit<Partial<ReadToolDeps<THost>>, FsToolsSharedKey>;
  readonly edit?: Omit<Partial<EditToolDeps<THost>>, FsToolsSharedKey>;
  readonly write?: Omit<Partial<WriteToolDeps<THost>>, FsToolsSharedKey>;
  readonly applyPatch?: Omit<Partial<ApplyPatchToolDeps<THost>>, FsToolsSharedKey>;
  /**
   * `true` or an options object adds a bash tool. Off by default. The runner
   * defaults to nodeCommandRunner({ cwd }), and env to
   * shellEnv(() => process.env). With your own runner, commands still run in
   * an explicit top-level cwd. bash.cwd wins over both.
   */
  readonly bash?: boolean | NodeFsToolsBashOptions<THost>;
}

export interface NodeFsTools<THost = undefined> {
  readonly read: ReadTool<THost>;
  readonly edit: EditTool<THost>;
  readonly write: WriteTool<THost>;
  readonly applyPatch: ApplyPatchTool<THost>;
  /** null unless options.bash is set. Runs in cwd. It does not share the read state: see invalidate. */
  readonly bash: BashTool<THost> | null;
  readonly fs: NodeFileSystem;
  readonly state: ReadStateStore | null;
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /**
   * Forgets the read record for a path, so the next edit needs a fresh read.
   * With state null it reports recorded: false. `call` is ignored.
   */
  invalidate(path: string, call?: ToolCallContext<THost>): Promise<InvalidateOutcome>;
}

/** The result when options.bash is true or an object: bash is there. */
export interface NodeFsToolsWithBash<THost = undefined> extends NodeFsTools<THost> {
  readonly bash: BashTool<THost>;
}

/**
 * Creates read, edit, write, and apply_patch tools over one local filesystem.
 * They share one read state store, digest, lock manager, and clock. With
 * `bash`, adds a bash tool in the same cwd. The allowed roots do not limit
 * what a bash command touches. To make the next edit after a command need a
 * read, call invalidate(path) from a bash afterRun hook.
 */
export function createNodeFsTools<THost = undefined>(
  options: CreateNodeFsToolsOptions<THost> & {
    readonly bash: true | NodeFsToolsBashOptions<THost>;
  },
): NodeFsToolsWithBash<THost>;
export function createNodeFsTools<THost = undefined>(
  options?: CreateNodeFsToolsOptions<THost>,
): NodeFsTools<THost>;
export function createNodeFsTools<THost = undefined>(
  options: CreateNodeFsToolsOptions<THost> = {},
): NodeFsTools<THost> {
  checkOptions(options);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const fs = nodeFileSystem({
    cwd,
    allowedRoots: options.allowedRoots ?? [cwd],
    ...pickDefined(options, [
      "denyRoots",
      "symlinks",
      "hardLinks",
      "newFileMode",
      "newDirectoryMode",
    ]),
  });
  const bash = options.bash === true ? {} : options.bash;
  const tools = createFsTools<THost>({
    fs,
    digest: options.digest ?? nodeDigest(),
    ...pickDefined(options, ["state", "locks", "clock", "read", "edit", "write", "applyPatch"]),
    ...(bash === undefined || bash === false ? {} : { bash: bashDeps(bash, options.cwd, cwd) }),
  });
  return Object.freeze<NodeFsTools<THost>>({
    read: tools.read,
    edit: tools.edit,
    write: tools.write,
    applyPatch: tools.applyPatch,
    bash: tools.bash,
    fs,
    state: tools.state,
    digest: tools.digest,
    locks: tools.locks,
    clock: tools.clock,
    invalidate: (target) => tools.invalidate(target),
  });
}

function checkOptions(options: unknown): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("createNodeFsTools options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!KNOWN_OPTIONS.has(key)) throw new TypeError(`Unknown createNodeFsTools option: ${key}`);
  }
  const state: unknown = (options as Record<string, unknown>).state;
  if (state !== undefined && state !== null && !isReadStateStore(state)) {
    throw new TypeError(
      `createNodeFsTools state must be a read state store or null: a bundle takes one store, not a per-call factory`,
    );
  }
  for (const [tool, keys] of Object.entries(BUNDLE_SHARED_KEYS_BY_TOOL)) {
    const part: unknown = (options as Record<string, unknown>)[tool];
    if (part === undefined || (tool === "bash" && typeof part === "boolean")) continue;
    if (part === null || typeof part !== "object" || Array.isArray(part)) {
      throw new TypeError(`createNodeFsTools ${tool} options must be an object`);
    }
    for (const key of keys) {
      if (Object.hasOwn(part, key)) {
        throw new TypeError(
          `createNodeFsTools ${tool} options cannot set ${key}: set it once at the top level`,
        );
      }
    }
  }
}

function pickDefined<T extends object, K extends keyof T>(
  options: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (options[key] !== undefined) picked[key] = options[key];
  }
  return picked;
}

function bashDeps<THost>(
  bash: NodeFsToolsBashOptions<THost>,
  explicitCwd: string | undefined,
  cwd: string,
): Omit<ShellToolDeps<THost>, "digest" | "clock"> {
  const deps = withNodeShellDefaults(bash, cwd);
  const customRunnerNeedsExplicitCwd =
    bash.runner !== undefined && explicitCwd !== undefined && bash.cwd === undefined;
  if (!customRunnerNeedsExplicitCwd) return deps;
  return { ...deps, cwd };
}

function isReadStateStore(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const store = value as Record<string, unknown>;
  return ["get", "put", "delete"].every((key) => typeof store[key] === "function");
}
