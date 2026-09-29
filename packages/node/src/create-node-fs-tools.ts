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

const KNOWN: ReadonlySet<string> = new Set([
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

/** The keys each tool's options may not set, because the bundle shares them. */
const SHARED_KEYS = {
  read: ["fs", "state", "digest", "clock"],
  edit: ["fs", "state", "digest", "locks", "clock"],
  write: ["fs", "state", "digest", "locks", "clock"],
  applyPatch: ["fs", "state", "digest", "locks", "clock"],
  bash: ["digest", "clock"],
} as const;

/**
 * The bash tool's dependencies, all optional. `runner` defaults to
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
  /** Default createMemoryStore({ clock }), on the bundle clock. null turns read-before-write off. */
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
   * Off by default: the bundle starts no process unless you ask. `true` or
   * an options object adds bash, with the bundle's digest and clock. The
   * runner defaults to nodeCommandRunner({ cwd }), and env to
   * shellEnv(() => process.env). With a given runner, an explicit top-level
   * cwd becomes the bash cwd dependency, so commands still run there.
   * bash.cwd wins over both.
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
   * Deletes the record for a path. With state null it still stats, and
   * reports recorded: false. `call` is ignored: the Node filesystem is fixed.
   * It is there so every bundle takes (path, call?).
   */
  invalidate(path: string, call?: ToolCallContext<THost>): Promise<InvalidateOutcome>;
}

/** The result when options.bash is true or an object: bash is there. */
export interface NodeFsToolsWithBash<THost = undefined> extends NodeFsTools<THost> {
  readonly bash: BashTool<THost>;
}

/**
 * createFsTools over one nodeFileSystem, with nodeDigest() for the digest.
 * read, edit, write, and apply_patch share one store, one digest, one lock
 * manager, and one clock. The write tools take the lock; read and bash take
 * none (D25). With `bash`, a bash tool in the same cwd. The allowed roots do
 * not limit what a bash command touches. A host that wants the next edit
 * after a command to need a read calls invalidate(path) from a bash afterRun
 * hook.
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
    ...pick(options, ["denyRoots", "symlinks", "hardLinks", "newFileMode", "newDirectoryMode"]),
  });
  const bash = options.bash === true ? {} : options.bash;
  const tools = createFsTools<THost>({
    fs,
    digest: options.digest ?? nodeDigest(),
    ...pick(options, ["state", "locks", "clock", "read", "edit", "write", "applyPatch"]),
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

/** An object, known keys, and no shared key inside a tool's options (GA-16). */
function checkOptions(options: unknown): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("createNodeFsTools options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!KNOWN.has(key)) throw new TypeError(`Unknown createNodeFsTools option: ${key}`);
  }
  for (const [tool, keys] of Object.entries(SHARED_KEYS)) {
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

/** The given keys whose value is not undefined, so an absent option stays absent. */
function pick<T extends object, K extends keyof T>(
  options: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (options[key] !== undefined) picked[key] = options[key];
  }
  return picked;
}

/**
 * The bash dependencies. Without a runner, nodeCommandRunner({ cwd }) runs in
 * cwd. A given runner has its own default cwd, so an explicit top-level cwd
 * is passed as the bash cwd dependency: it must not be dropped in silence.
 */
function bashDeps<THost>(
  bash: NodeFsToolsBashOptions<THost>,
  given: string | undefined,
  cwd: string,
): Omit<ShellToolDeps<THost>, "digest" | "clock"> {
  const deps = withNodeShellDefaults(bash, cwd);
  if (bash.runner === undefined || given === undefined || bash.cwd !== undefined) return deps;
  return { ...deps, cwd };
}
