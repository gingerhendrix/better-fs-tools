import type { WritableFileSystem } from "@better-fs-tools/fs";
import { createMemoryStore, createReadTool, sha256Digest } from "@better-fs-tools/read";
import type {
  Clock,
  Digest,
  ReadStateStore,
  ReadTool,
  ReadToolDeps,
  ToolCallContext,
} from "@better-fs-tools/read";
import { createBashTool } from "@better-fs-tools/shell";
import type { BashTool, ShellToolDeps } from "@better-fs-tools/shell";

import type { EditTool, ApplyPatchTool, WriteTool } from "../contract/context.ts";
import type { ApplyPatchToolDeps, EditToolDeps, WriteToolDeps } from "../contract/deps.ts";
import type { LockManager } from "../contract/locks.ts";
import { createApplyPatchTool, createEditTool, createWriteTool } from "../core/create-tools.ts";
import { isWritable } from "../core/deps.ts";
import { messageOf } from "../core/outcomes.ts";
import { memoryLocks } from "../locks/index.ts";
import { createInvalidator } from "../state/invalidate.ts";
import type { InvalidateOutcome } from "../state/invalidate.ts";

/** Set once at the top level for every tool. A tool's own options cannot set them. */
export type FsToolsSharedKey = "fs" | "state" | "digest" | "locks" | "clock";

/** The bash dependencies, less the digest and the clock, which the bundle shares. */
export type FsToolsBashOptions<THost = undefined> = Omit<ShellToolDeps<THost>, "digest" | "clock">;

export interface CreateFsToolsOptions<THost = undefined> {
  /** Required. A backend, or a factory called once for each call. */
  readonly fs: WritableFileSystem | ((call: ToolCallContext<THost>) => WritableFileSystem);
  /** Default createMemoryStore({ clock }), on the bundle clock. null turns read-before-write off. */
  readonly state?: ReadStateStore | null;
  /** Default sha256Digest(): plain JavaScript, so a Worker needs no host digest. */
  readonly digest?: Digest;
  /** Default memoryLocks(), shared by edit, write, and apply_patch. */
  readonly locks?: LockManager;
  /** Default () => new Date(). */
  readonly clock?: Clock;
  readonly read?: Omit<Partial<ReadToolDeps<THost>>, FsToolsSharedKey>;
  readonly edit?: Omit<Partial<EditToolDeps<THost>>, FsToolsSharedKey>;
  readonly write?: Omit<Partial<WriteToolDeps<THost>>, FsToolsSharedKey>;
  readonly applyPatch?: Omit<Partial<ApplyPatchToolDeps<THost>>, FsToolsSharedKey>;
  /**
   * Off by default: the bundle starts no process unless you ask. The object
   * is the bash tool's dependencies, with `runner` and `env` required. The
   * bundle adds its digest and clock. `false` is the same as leaving it out.
   */
  readonly bash?: false | FsToolsBashOptions<THost>;
}

export interface FsTools<THost = undefined> {
  readonly read: ReadTool<THost>;
  readonly edit: EditTool<THost>;
  readonly write: WriteTool<THost>;
  readonly applyPatch: ApplyPatchTool<THost>;
  /** null unless options.bash is set. It does not share the read state: see invalidate. */
  readonly bash: BashTool<THost> | null;
  readonly fs: CreateFsToolsOptions<THost>["fs"];
  readonly state: ReadStateStore | null;
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /**
   * Deletes the record for a path, so the next edit or write needs a read.
   * Never throws. With state null it still stats, and reports recorded: false.
   * When fs is a factory, pass the call context (a hook has it as ctx.call):
   * without it the outcome is ok: false with reason unsupported.
   */
  invalidate(path: string, call?: ToolCallContext<THost>): Promise<InvalidateOutcome>;
}

/** The result when options.bash is an object: bash is there. */
export interface FsToolsWithBash<THost = undefined> extends FsTools<THost> {
  readonly bash: BashTool<THost>;
}

const KNOWN: ReadonlySet<string> = new Set([
  "fs",
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

/** With state null, invalidate still stats the path, and there is never a record. */
const NO_STATE: ReadStateStore = Object.freeze({
  get: async () => null,
  put: async () => {},
  delete: async () => {},
});

/**
 * read, edit, write, and apply_patch over one backend, with one read store,
 * one digest, one lock manager, and one clock. With `bash`, a bash tool that
 * gets the same digest and clock. It runs anywhere: nothing here needs Node.
 *
 * The write tools take the lock; read and bash take none. The backend's
 * roots do not limit what a bash command touches. A host that wants the next
 * edit after a command to need a read calls invalidate(path) from a bash
 * afterRun hook.
 *
 * Throws TypeError on an unknown option key, on a shared key (fs, state,
 * digest, locks, clock) inside a tool's options, and on anything a tool
 * factory refuses.
 */
export function createFsTools<THost = undefined>(
  options: CreateFsToolsOptions<THost> & { readonly bash: FsToolsBashOptions<THost> },
): FsToolsWithBash<THost>;
export function createFsTools<THost = undefined>(
  options: CreateFsToolsOptions<THost>,
): FsTools<THost>;
export function createFsTools<THost = undefined>(
  options: CreateFsToolsOptions<THost>,
): FsTools<THost> {
  checkFsToolsOptions("createFsTools", options, KNOWN, SHARED_KEYS);
  const { fs } = options;
  const clock = options.clock ?? (() => new Date());
  // The default store expires records on the bundle's clock too.
  const state = options.state === undefined ? createMemoryStore({ clock }) : options.state;
  const digest = options.digest ?? sha256Digest();
  const locks = options.locks ?? memoryLocks();
  const shared = { fs, state, digest, clock };
  const bash = options.bash === undefined || options.bash === false ? null : options.bash;
  if ((bash as unknown) === true) {
    throw new TypeError(
      "createFsTools bash must be an object with a runner and an env: the portable bundle has no default runner",
    );
  }

  return Object.freeze<FsTools<THost>>({
    read: createReadTool<THost>({ ...options.read, ...shared }),
    edit: createEditTool<THost>({ ...options.edit, ...shared, locks }),
    write: createWriteTool<THost>({ ...options.write, ...shared, locks }),
    applyPatch: createApplyPatchTool<THost>({ ...options.applyPatch, ...shared, locks }),
    bash: bash === null ? null : createBashTool<THost>({ ...bash, digest, clock }),
    fs,
    state,
    digest,
    locks,
    clock,
    invalidate: invalidator(fs, state ?? NO_STATE),
  });
}

/** An object, known top-level keys, and no shared key inside a tool's options. */
function checkFsToolsOptions(
  label: string,
  options: unknown,
  known: ReadonlySet<string>,
  sharedKeys: Readonly<Record<string, readonly string[]>>,
): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${label} options must be an object`);
  }
  for (const key of Object.keys(options)) {
    if (!known.has(key)) throw new TypeError(`Unknown ${label} option: ${key}`);
  }
  const state: unknown = (options as Record<string, unknown>).state;
  if (state !== undefined && state !== null && !isStore(state)) {
    throw new TypeError(
      `${label} state must be a read state store or null: a bundle takes one store, not a per-call factory`,
    );
  }
  for (const [tool, keys] of Object.entries(sharedKeys)) {
    const part: unknown = (options as Record<string, unknown>)[tool];
    if (part === undefined || (tool === "bash" && typeof part === "boolean")) continue;
    if (part === null || typeof part !== "object" || Array.isArray(part)) {
      throw new TypeError(`${label} ${tool} options must be an object`);
    }
    for (const key of keys) {
      if (Object.hasOwn(part, key)) {
        throw new TypeError(
          `${label} ${tool} options cannot set ${key}: set it once at the top level`,
        );
      }
    }
  }
}

/** One invalidator for a fixed backend. A factory backend is built from the call. */
function invalidator<THost>(
  fs: CreateFsToolsOptions<THost>["fs"],
  state: ReadStateStore,
): FsTools<THost>["invalidate"] {
  if (typeof fs !== "function") {
    const fixed = createInvalidator({ fs, state });
    return (path) => fixed(path);
  }
  return async (path, call) => {
    if (call === undefined) {
      return {
        ok: false,
        phase: "stat",
        error: {
          reason: "unsupported",
          detail: "fs is a factory: pass the call context to invalidate(path, call)",
        },
      };
    }
    let backend: unknown;
    try {
      backend = fs(call);
    } catch (error) {
      return { ok: false, phase: "stat", error: { reason: "io", detail: messageOf(error) } };
    }
    if (!isWritable(backend)) {
      return {
        ok: false,
        phase: "stat",
        error: {
          reason: "unsupported",
          detail: "the fs factory did not return a writable filesystem",
        },
      };
    }
    return createInvalidator({ fs: backend, state })(path);
  };
}

/** A read state store: an object with get, put, and delete. A per-call factory is not one. */
function isStore(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const store = value as Record<string, unknown>;
  return ["get", "put", "delete"].every((key) => typeof store[key] === "function");
}
