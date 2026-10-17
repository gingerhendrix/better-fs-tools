import type { WritableFileSystem } from "@better-fs-tools/fs";
import { createReadTool, sha256Digest } from "@better-fs-tools/read";
import type {
  Clock,
  Digest,
  ReadStateStore,
  ReadTool,
  ReadToolOptions,
  ToolCallContext,
} from "@better-fs-tools/read";
import { createBashTool } from "@better-fs-tools/shell";
import type { BashTool, BashToolOptions } from "@better-fs-tools/shell";

import type { EditTool, ApplyPatchTool, WriteTool } from "../contract/context.ts";
import type { ApplyPatchToolOptions, EditToolOptions, WriteToolOptions } from "../contract/deps.ts";
import type { LockManager } from "../contract/locks.ts";
import { createApplyPatchTool, createEditTool, createWriteTool } from "../core/create-tools.ts";
import { isWritable } from "../core/deps.ts";
import { messageOf } from "../core/outcomes.ts";
import { memoryLocks } from "../locks/index.ts";
import { createInvalidator } from "../state/invalidate.ts";
import type { InvalidateOutcome } from "../state/invalidate.ts";

/** A read state store, a factory of the call, or null. */
export type FsToolsState<THost = undefined> =
  | ReadStateStore
  | ((call: ToolCallContext<THost>) => ReadStateStore | null)
  | null;

/** Options set once for the whole bundle. A tool's own options cannot set them. */
export type FsToolsSharedKey = "fs" | "state" | "digest" | "locks" | "clock";

/** The bash tool's options, without the digest and clock that the bundle shares. */
export type FsToolsBashOptions<THost = undefined> = Omit<
  BashToolOptions<THost>,
  "digest" | "clock"
>;

/** The read tool's options, without the options that the bundle shares. */
export type FsToolsReadOptions<THost = undefined> = Omit<
  Partial<ReadToolOptions<THost>>,
  FsToolsSharedKey
>;

/** The edit tool's options, without the options that the bundle shares. */
export type FsToolsEditOptions<THost = undefined> = Omit<
  Partial<EditToolOptions<THost>>,
  FsToolsSharedKey
>;

/** The write tool's options, without the options that the bundle shares. */
export type FsToolsWriteOptions<THost = undefined> = Omit<
  Partial<WriteToolOptions<THost>>,
  FsToolsSharedKey
>;

/** The apply_patch tool's options, without the options that the bundle shares. */
export type FsToolsApplyPatchOptions<THost = undefined> = Omit<
  Partial<ApplyPatchToolOptions<THost>>,
  FsToolsSharedKey
>;

export interface FsToolsOptions<THost = undefined> {
  /** Required. A backend, or a factory called once for each call. */
  readonly fs: WritableFileSystem | ((call: ToolCallContext<THost>) => WritableFileSystem);
  /**
   * Default null: no read-before-write. A store, for example
   * memoryStore({ clock }), turns it on for edit, write, and apply_patch. A
   * factory gives each call its own store: every tool calls it at most once
   * for each call.
   */
  readonly state?: FsToolsState<THost>;
  /** Default sha256Digest(). */
  readonly digest?: Digest;
  /** Default memoryLocks(), shared by edit, write, and apply_patch. */
  readonly locks?: LockManager;
  /** Default () => new Date(). */
  readonly clock?: Clock;
  readonly read?: FsToolsReadOptions<THost>;
  readonly edit?: FsToolsEditOptions<THost>;
  readonly write?: FsToolsWriteOptions<THost>;
  /**
   * Off by default. `true` or an options object adds an apply_patch tool.
   * `false` is the same as leaving it out.
   */
  readonly applyPatch?: boolean | FsToolsApplyPatchOptions<THost>;
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
  /** null unless options.applyPatch is true or an object. */
  readonly applyPatch: ApplyPatchTool<THost> | null;
  /** null unless options.bash is set. It does not share the read state: see invalidate. */
  readonly bash: BashTool<THost> | null;
  readonly fs: FsToolsOptions<THost>["fs"];
  readonly state: FsToolsState<THost>;
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /**
   * Deletes the read record for a path, so the next edit or write needs a
   * fresh read. Never throws. When fs or state is a factory, pass the call
   * context (a hook has it as ctx.call), or the outcome is ok: false.
   */
  invalidate(path: string, call?: ToolCallContext<THost>): Promise<InvalidateOutcome>;
}

/** The result when options.bash is an object: bash is there. */
export interface FsToolsWithBash<THost = undefined> extends FsTools<THost> {
  readonly bash: BashTool<THost>;
}

/** The result when options.applyPatch is true or an object: applyPatch is there. */
export interface FsToolsWithApplyPatch<THost = undefined> extends FsTools<THost> {
  readonly applyPatch: ApplyPatchTool<THost>;
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
 * Creates read, edit, and write tools over one backend, sharing one digest,
 * lock manager, and clock, and the read store when `state` is given. With
 * `applyPatch`, also an apply_patch tool. With `bash`, also a bash tool with
 * the same digest and clock. Needs no Node APIs.
 *
 * A bash command is not limited by the backend's roots and does not update the
 * read state. To make the next edit after a command need a read, call
 * invalidate(path) from a bash afterRun hook.
 *
 * Throws TypeError on an unknown option, a shared option inside a tool's
 * options, or anything a tool factory refuses.
 */
export function createFsTools<THost = undefined>(
  options: FsToolsOptions<THost> & {
    readonly bash: FsToolsBashOptions<THost>;
    readonly applyPatch: true | FsToolsApplyPatchOptions<THost>;
  },
): FsToolsWithBash<THost> & FsToolsWithApplyPatch<THost>;
export function createFsTools<THost = undefined>(
  options: FsToolsOptions<THost> & { readonly bash: FsToolsBashOptions<THost> },
): FsToolsWithBash<THost>;
export function createFsTools<THost = undefined>(
  options: FsToolsOptions<THost> & {
    readonly applyPatch: true | FsToolsApplyPatchOptions<THost>;
  },
): FsToolsWithApplyPatch<THost>;
export function createFsTools<THost = undefined>(options: FsToolsOptions<THost>): FsTools<THost>;
export function createFsTools<THost = undefined>(options: FsToolsOptions<THost>): FsTools<THost> {
  const bundle = resolveBundle("createFsTools", options);
  const { fs, state, digest, locks, clock } = bundle;
  const shared = { fs, state, digest, clock };

  return Object.freeze<FsTools<THost>>({
    read: createReadTool<THost>({ ...options.read, ...shared }),
    edit: createEditTool<THost>({ ...options.edit, ...shared, locks }),
    write: createWriteTool<THost>({ ...options.write, ...shared, locks }),
    applyPatch:
      bundle.applyPatch === null
        ? null
        : createApplyPatchTool<THost>({ ...bundle.applyPatch, ...shared, locks }),
    bash: bundle.bash === null ? null : createBashTool<THost>({ ...bundle.bash, digest, clock }),
    fs,
    state,
    digest,
    locks,
    clock,
    invalidate: bundle.invalidate,
  });
}

/** The option shape that createFsTools() and fsToolDefinitions() share. */
interface BundleOptions<THost, TApplyPatch, TBash> {
  readonly fs: FsToolsOptions<THost>["fs"];
  readonly state?: FsToolsState<THost>;
  readonly digest?: Digest;
  readonly locks?: LockManager;
  readonly clock?: Clock;
  readonly applyPatch?: boolean | TApplyPatch;
  readonly bash?: false | TBash;
}

/** A bundle's shared parts, after the option checks. */
export interface ResolvedBundle<THost, TApplyPatch, TBash> {
  readonly fs: FsToolsOptions<THost>["fs"];
  readonly state: FsToolsState<THost>;
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /** The apply_patch options, or null when it is off. */
  readonly applyPatch: Partial<TApplyPatch> | null;
  /** The bash options, or null when it is off. */
  readonly bash: TBash | null;
  readonly invalidate: FsTools<THost>["invalidate"];
}

/**
 * Checks the bundle options and resolves the shared defaults. Throws TypeError
 * that names `label` on an unknown key, a shared key inside a tool's options,
 * a malformed state, and bash: true.
 */
export function resolveBundle<THost, TApplyPatch extends object, TBash extends object>(
  label: string,
  options: BundleOptions<THost, TApplyPatch, TBash>,
): ResolvedBundle<THost, TApplyPatch, TBash> {
  checkFsToolsOptions(label, options, KNOWN_OPTION_KEYS, SHARED_KEYS_BY_TOOL);
  const { fs } = options;
  const state = options.state ?? null;
  const bash = options.bash === undefined || options.bash === false ? null : options.bash;
  if ((bash as unknown) === true) {
    throw new TypeError(
      `${label} bash must be an object with a runner and an env: the portable bundle has no default runner`,
    );
  }
  return {
    fs,
    state,
    digest: options.digest ?? sha256Digest(),
    locks: options.locks ?? memoryLocks(),
    clock: options.clock ?? (() => new Date()),
    applyPatch:
      options.applyPatch === true
        ? {}
        : options.applyPatch === false || options.applyPatch === undefined
          ? null
          : options.applyPatch,
    bash,
    invalidate: invalidator(fs, state),
  };
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
  if (state !== undefined && state !== null && typeof state !== "function" && !isStore(state)) {
    throw new TypeError(
      `${label} state must be a read state store, a function that returns one, or null`,
    );
  }
  for (const [tool, keys] of Object.entries(sharedKeys)) {
    const part: unknown = (options as Record<string, unknown>)[tool];
    if (part === undefined) continue;
    if ((tool === "bash" || tool === "applyPatch") && typeof part === "boolean") continue;
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
  fs: FsToolsOptions<THost>["fs"],
  state: FsToolsState<THost>,
): FsTools<THost>["invalidate"] {
  if (typeof fs !== "function" && typeof state !== "function") {
    const fixed = createInvalidator({ fs, state: state ?? EMPTY_STATE_STORE });
    return (path) => fixed(path);
  }
  return async (path, call) => {
    if (call === undefined) {
      const factory = typeof fs === "function" ? "fs" : "state";
      return {
        ok: false,
        phase: "stat",
        error: {
          reason: "unsupported",
          detail: `${factory} is a factory: pass the call context to invalidate(path, call)`,
        },
      };
    }
    let backend: unknown;
    let store: ReadStateStore | null;
    try {
      backend = typeof fs === "function" ? fs(call) : fs;
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
    try {
      store = typeof state === "function" ? state(call) : state;
    } catch (error) {
      return { ok: false, phase: "state", detail: messageOf(error) };
    }
    if (store !== null && !isStore(store)) {
      return {
        ok: false,
        phase: "state",
        detail: "the state factory did not return a read state store or null",
      };
    }
    return createInvalidator({ fs: backend, state: store ?? EMPTY_STATE_STORE })(path);
  };
}

function isStore(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const store = value as Record<string, unknown>;
  return ["get", "put", "delete"].every((key) => typeof store[key] === "function");
}
