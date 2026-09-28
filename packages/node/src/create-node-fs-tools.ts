import path from "node:path";

import { createReadTool } from "@better-fs-tools/read";
import type { Digest, ReadStateStore, ReadTool, ReadToolDeps } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";
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
  /** The runner defaults to nodeCommandRunner({ cwd }). */
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
  /** createInvalidator over fs and state. A no-op when state is null. */
  invalidate(path: string): Promise<void>;
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
  const invalidate = state === null ? null : createInvalidator({ fs, state });

  return Object.freeze<NodeFsTools<THost>>({
    read: createReadTool<THost>({ ...options.read, ...shared }),
    edit: createEditTool<THost>({ ...options.edit, ...shared, locks }),
    write: createWriteTool<THost>({ ...options.write, ...shared, locks }),
    applyPatch: createApplyPatchTool<THost>({ ...options.applyPatch, ...shared, locks }),
    bash: createBashTool<THost>(withNodeShellDefaults(options.bash ?? {}, cwd)),
    fs,
    state,
    locks,
    invalidate: async (path) => {
      await invalidate?.(path);
    },
  });
}
