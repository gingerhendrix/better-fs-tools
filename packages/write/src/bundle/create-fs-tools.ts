import type { WritableFileSystem } from "@better-fs-tools/fs";
import { createReadTool, sha256Digest } from "@better-fs-tools/read";
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

/** Options set once for the whole bundle. A tool's own options cannot set them. */
export type FsToolsSharedKey = "fs" | "state" | "digest" | "locks" | "clock";

/** The bash tool's options, without the digest and clock that the bundle shares. */
export type FsToolsBashOptions<THost = undefined> = Omit<ShellToolDeps<THost>, "digest" | "clock">;

export interface CreateFsToolsOptions<THost = undefined> {
  /** Required. A backend, or a factory called once for each call. */
  readonly fs: WritableFileSystem | ((call: ToolCallContext<THost>) => WritableFileSystem);
  /**
   * Default null: no read-before-write. A store, for example
   * memoryStore({ clock }), turns it on for edit, write, and apply_patch.
   */
  readonly state?: ReadStateStore | null;
  /** Default sha256Digest(). */
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
   * Off by default. The bash tool's options, with `runner` and `env` required.
   * `false` is the same as leaving it out.
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
   * Deletes the read record for a path, so the next edit or write needs a
   * fresh read. Never throws. When fs is a factory, pass the call context (a
   * hook has it as ctx.call), or the outcome is ok: false.
   */
  invalidate(path: string, call?: ToolCallContext<THost>): Promise<InvalidateOutcome>;
}

/** The result when options.bash is an object: bash is there. */
export interface FsToolsWithBash<THost = undefined> extends FsTools<THost> {
  readonly bash: BashTool<THost>;
}

const KNOWN_OPTION_KEYS: ReadonlySet<string> = new Set([
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

const SHARED_KEYS_BY_TOOL = {
  read: ["fs", "state", "digest", "clock"],
  edit: ["fs", "state", "digest", "locks", "clock"],
  write: ["fs", "state", "digest", "locks", "clock"],
  applyPatch: ["fs", "state", "digest", "locks", "clock"],
  bash: ["digest", "clock"],
} as const;

const EMPTY_STATE_STORE: ReadStateStore = Object.freeze({
  get: async () => null,
  put: async () => {},
  delete: async () => {},
});

/**
 * Creates read, edit, write, and apply_patch tools over one backend, sharing
 * one read store, digest, lock manager, and clock. With `bash`, also a bash
 * tool with the same digest and clock. Needs no Node APIs.
 *
 * A bash command is not limited by the backend's roots and does not update the
 * read state. To make the next edit after a command need a read, call
 * invalidate(path) from a bash afterRun hook.
 *
 * Throws TypeError on an unknown option, a shared option inside a tool's
 * options, or anything a tool factory refuses.
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
  checkFsToolsOptions("createFsTools", options, KNOWN_OPTION_KEYS, SHARED_KEYS_BY_TOOL);
  const { fs } = options;
  const clock = options.clock ?? (() => new Date());
  const state = options.state ?? null;
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
    invalidate: invalidator(fs, state ?? EMPTY_STATE_STORE),
  });
}

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

function isStore(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const store = value as Record<string, unknown>;
  return ["get", "put", "delete"].every((key) => typeof store[key] === "function");
}
