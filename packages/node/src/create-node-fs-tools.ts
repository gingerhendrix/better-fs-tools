import path from "node:path";

import { createMemoryStore, createReadTool } from "@better-fs-tools/read";
import type { Digest, ReadStateStore, ReadTool, ReadToolDeps } from "@better-fs-tools/read";
import {
  createApplyPatchTool,
  createEditTool,
  createInvalidator,
  createWriteTool,
  memoryLocks,
} from "@better-fs-tools/write";
import type {
  ApplyPatchTool,
  ApplyPatchToolDeps,
  EditTool,
  EditToolDeps,
  InvalidateOutcome,
  LockManager,
  WriteTool,
  WriteToolDeps,
} from "@better-fs-tools/write";

import { createBashTool } from "@better-fs-tools/shell";
import type { BashTool, ShellToolDeps } from "@better-fs-tools/shell";

import { withNodeShellDefaults } from "./create-node-bash-tool.ts";
import { nodeDigest } from "./digest.ts";
import { nodeFileSystem } from "./filesystem.ts";
import type { NodeFileSystem } from "./filesystem.ts";

type Shared = "fs" | "state" | "digest" | "locks";

const KNOWN = new Set([
  "cwd",
  "allowedRoots",
  "denyRoots",
  "symlinks",
  "hardLinks",
  "state",
  "digest",
  "locks",
  "read",
  "edit",
  "write",
  "applyPatch",
  "bash",
]);
/** With state null, invalidate still stats the path, and there is never a record. */
const NO_STATE: ReadStateStore = Object.freeze({
  get: async () => null,
  put: async () => {},
  delete: async () => {},
});

/** The keys each tool's options may not set, because the bundle shares them. */
const SHARED_KEYS = {
  read: ["fs", "state", "digest"],
  edit: ["fs", "state", "digest", "locks"],
  write: ["fs", "state", "digest", "locks"],
  applyPatch: ["fs", "state", "digest", "locks"],
} as const;

export interface CreateNodeFsToolsOptions<THost = undefined> {
  /** Default process.cwd(). */
  readonly cwd?: string;
  /** Default [cwd]. */
  readonly allowedRoots?: readonly string[];
  readonly denyRoots?: readonly string[];
  readonly symlinks?: "follow-within-roots" | "reject";
  readonly hardLinks?: "refuse" | "in-place";
  /** Default createMemoryStore(). null turns read-before-write off. */
  readonly state?: ReadStateStore | null;
  /** Default nodeDigest(). */
  readonly digest?: Digest;
  /** Default memoryLocks(). */
  readonly locks?: LockManager;
  readonly read?: Omit<Partial<ReadToolDeps<THost>>, "fs" | "state" | "digest">;
  readonly edit?: Omit<Partial<EditToolDeps<THost>>, Shared>;
  readonly write?: Omit<Partial<WriteToolDeps<THost>>, Shared>;
  readonly applyPatch?: Omit<Partial<ApplyPatchToolDeps<THost>>, Shared>;
  /**
   * The runner defaults to nodeCommandRunner({ cwd }). With a given runner,
   * an explicit top-level cwd becomes the bash cwd dependency, so commands
   * still run there. bash.cwd wins over both.
   */
  readonly bash?: Partial<ShellToolDeps<THost>>;
}

export interface NodeFsTools<THost = undefined> {
  readonly read: ReadTool<THost>;
  readonly edit: EditTool<THost>;
  readonly write: WriteTool<THost>;
  readonly applyPatch: ApplyPatchTool<THost>;
  /** Runs in cwd. It does not share the read state: see invalidate. */
  readonly bash: BashTool<THost>;
  readonly fs: NodeFileSystem;
  readonly state: ReadStateStore | null;
  readonly locks: LockManager;
  /** createInvalidator over fs and state. With state null it still stats, and reports recorded: false. */
  invalidate(path: string): Promise<InvalidateOutcome>;
}

/**
 * One filesystem, one store, one digest, and one lock manager for the four
 * file tools, and a bash tool in the same cwd. The write tools take the
 * lock; read and bash take none (D25). The allowed roots do not limit what a
 * bash command touches. A host that wants the next edit after a command to
 * need a read can call invalidate(path) from a bash afterRun hook.
 */
export function createNodeFsTools<THost = undefined>(
  options: CreateNodeFsToolsOptions<THost> = {},
): NodeFsTools<THost> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("createNodeFsTools options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!KNOWN.has(key)) throw new TypeError(`Unknown createNodeFsTools option: ${key}`);
  }
  for (const [tool, keys] of Object.entries(SHARED_KEYS)) {
    const part: unknown = options[tool as keyof typeof SHARED_KEYS];
    if (part === undefined) continue;
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
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const fs = nodeFileSystem({
    cwd,
    allowedRoots: options.allowedRoots ?? [cwd],
    ...(options.denyRoots === undefined ? {} : { denyRoots: options.denyRoots }),
    ...(options.symlinks === undefined ? {} : { symlinks: options.symlinks }),
    ...(options.hardLinks === undefined ? {} : { hardLinks: options.hardLinks }),
  });
  const state = options.state === undefined ? createMemoryStore() : options.state;
  const digest = options.digest ?? nodeDigest();
  const locks = options.locks ?? memoryLocks();
  const shared = { fs, state, digest };
  const invalidate = createInvalidator({ fs, state: state ?? NO_STATE });

  return Object.freeze<NodeFsTools<THost>>({
    read: createReadTool<THost>({ ...options.read, ...shared }),
    edit: createEditTool<THost>({ ...options.edit, ...shared, locks }),
    write: createWriteTool<THost>({ ...options.write, ...shared, locks }),
    applyPatch: createApplyPatchTool<THost>({ ...options.applyPatch, ...shared, locks }),
    bash: createBashTool<THost>(bashDeps(options.bash ?? {}, options.cwd, cwd)),
    fs,
    state,
    locks,
    invalidate,
  });
}

/**
 * The bash dependencies. Without a runner, nodeCommandRunner({ cwd }) runs in
 * cwd. A given runner has its own default cwd, so an explicit top-level cwd
 * is passed as the bash cwd dependency: it must not be dropped in silence.
 */
function bashDeps<THost>(
  bash: Partial<ShellToolDeps<THost>>,
  given: string | undefined,
  cwd: string,
): ShellToolDeps<THost> {
  if (bash === null || typeof bash !== "object" || Array.isArray(bash)) {
    throw new TypeError("createNodeFsTools bash options must be an object");
  }
  const deps = withNodeShellDefaults(bash, cwd);
  if (bash.runner === undefined || given === undefined || bash.cwd !== undefined) return deps;
  return { ...deps, cwd };
}
