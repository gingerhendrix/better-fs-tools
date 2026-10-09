import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { nodeDigest } from "@better-fs-tools/node";
import type { Clock, Digest, ReadStateStore, ToolCallContext } from "@better-fs-tools/read";
import { createFsTools } from "@better-fs-tools/write";
import type { FsToolsSharedKey, InvalidateOutcome, LockManager } from "@better-fs-tools/write";

import {
  adaptPiMutationTool,
  piApplyPatchParts,
  piEditParts,
  piWriteParts,
} from "./mutation-tools.ts";
import type {
  CreatePiApplyPatchToolOptions,
  CreatePiEditToolOptions,
  CreatePiWriteToolOptions,
  PiMutationOptions,
  PiMutationTool,
} from "./mutation-tools.ts";
import { checkPiOptions, PI_ROOT_KEYS, piFileSystems } from "./roots.ts";
import type { PiRootOptions } from "./roots.ts";
import { adaptPiReadTool, piReadDeps, piReadParts } from "./tool.ts";
import type { CreatePiReadToolOptions, PiReadTool } from "./tool.ts";

type BundleSharedKey = FsToolsSharedKey | keyof PiRootOptions;

const KNOWN_OPTIONS: ReadonlySet<string> = new Set([
  "state",
  "digest",
  "locks",
  "clock",
  ...PI_ROOT_KEYS,
  "read",
  "edit",
  "write",
  "applyPatch",
]);
const BUNDLE_SHARED_KEYS = ["state", "digest", "locks", "clock", ...PI_ROOT_KEYS] as const;

export interface CreatePiFsToolsOptions extends PiRootOptions {
  /** Default null: no read-before-write. A store, for example memoryStore(), turns it on. */
  readonly state?: ReadStateStore | null;
  /** Default nodeDigest(). */
  readonly digest?: Digest;
  /** Default memoryLocks(). */
  readonly locks?: LockManager;
  /** Default () => new Date(). */
  readonly clock?: Clock;
  readonly read?: Omit<CreatePiReadToolOptions, BundleSharedKey>;
  readonly edit?: Omit<CreatePiEditToolOptions, BundleSharedKey>;
  readonly write?: Omit<CreatePiWriteToolOptions, BundleSharedKey>;
  /** Off by default. `true` or an options object adds an apply_patch tool. */
  readonly applyPatch?: boolean | Omit<CreatePiApplyPatchToolOptions, BundleSharedKey>;
}

export interface PiFsTools {
  readonly read: PiReadTool;
  readonly edit: PiMutationTool;
  readonly write: PiMutationTool;
  /** null unless options.applyPatch is true or an object. */
  readonly applyPatch: PiMutationTool | null;
  readonly state: ReadStateStore | null;
  /** options.digest, or nodeDigest(). */
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /**
   * Forgets the read record for a path under the call's ctx.cwd, so the next
   * edit needs a read. Pass the call; in a bash afterRun hook it is ctx.call.
   * Without it the outcome is { ok: false } with reason "unsupported". Never
   * throws. With state null it reports recorded: false.
   */
  invalidate(path: string, call?: ToolCallContext<ExtensionContext>): Promise<InvalidateOutcome>;
}

/** The createPiFsTools result when `applyPatch` is true or an object: it is never null. */
export interface PiFsToolsWithApplyPatch extends PiFsTools {
  readonly applyPatch: PiMutationTool;
}

/**
 * Creates Pi read, edit, and write tools rooted at each call's ctx.cwd, and
 * an apply_patch tool when `applyPatch` is true or an object. They share one
 * digest, lock manager, and clock, and the read store when `state` is given.
 * Throws TypeError on fs, cwd, or allowedRoots anywhere in the options, on an
 * unknown key, and on a shared option (state, digest, locks, clock, or a root
 * option) inside one tool's options. There is no bash: register
 * createPiBashTool() and call invalidate from its afterRun hook.
 */
export function createPiFsTools(
  options: CreatePiFsToolsOptions & {
    readonly applyPatch: true | Omit<CreatePiApplyPatchToolOptions, BundleSharedKey>;
  },
): PiFsToolsWithApplyPatch;
export function createPiFsTools(options?: CreatePiFsToolsOptions): PiFsTools;
export function createPiFsTools(options: CreatePiFsToolsOptions = {}): PiFsTools {
  checkPiOptions(options, "fs");
  for (const key of Object.keys(options)) {
    if (!KNOWN_OPTIONS.has(key)) throw new TypeError(`Unknown createPiFsTools option: ${key}`);
  }
  const state: unknown = (options as Record<string, unknown>).state;
  if (state !== undefined && state !== null && !isReadStateStore(state)) {
    throw new TypeError(
      `createPiFsTools state must be a read state store or null: a bundle takes one store, not a per-call factory`,
    );
  }
  const given = {
    read: options.read ?? {},
    edit: options.edit ?? {},
    write: options.write ?? {},
    applyPatch:
      options.applyPatch === true
        ? {}
        : options.applyPatch === false || options.applyPatch === undefined
          ? null
          : options.applyPatch,
  };
  for (const [key, value] of Object.entries(given)) {
    if (value === null) continue;
    checkPiOptions(value, key);
    for (const shared of BUNDLE_SHARED_KEYS) {
      if (Object.hasOwn(value, shared)) {
        throw new TypeError(
          `createPiFsTools ${key} options cannot set ${shared}: set it once at the top level`,
        );
      }
    }
  }

  const { denyRoots, symlinks, hardLinks, newFileMode, newDirectoryMode } = options;
  const fs = piFileSystems({ denyRoots, symlinks, hardLinks, newFileMode, newDirectoryMode });
  const {
    signature: _readSignature,
    promptSnippet: _readSnippet,
    promptGuidelines: _readLines,
    ...read
  } = given.read;
  const {
    signature: _editSignature,
    promptSnippet: _editSnippet,
    promptGuidelines: _editLines,
    ...edit
  } = given.edit;
  const {
    signature: _writeSignature,
    promptSnippet: _writeSnippet,
    promptGuidelines: _writeLines,
    ...write
  } = given.write;
  const parts = {
    read: piReadParts(given.read),
    edit: piEditParts(given.edit),
    write: piWriteParts(given.write),
  };
  let patch: {
    readonly deps: Omit<
      CreatePiApplyPatchToolOptions,
      BundleSharedKey | keyof PiMutationOptions<unknown>
    >;
    readonly parts: ReturnType<typeof piApplyPatchParts>;
  } | null = null;
  if (given.applyPatch !== null) {
    const {
      signature: _patchSignature,
      promptSnippet: _patchSnippet,
      promptGuidelines: _patchLines,
      ...deps
    } = given.applyPatch;
    patch = { deps, parts: piApplyPatchParts(given.applyPatch) };
  }

  const core = createFsTools<ExtensionContext>({
    fs,
    digest: options.digest ?? nodeDigest(),
    ...(options.state === undefined ? {} : { state: options.state }),
    ...(options.locks === undefined ? {} : { locks: options.locks }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    read: { ...read, ...piReadDeps(parts.read) },
    edit: { ...edit, messages: parts.edit.messages },
    write: { ...write, messages: parts.write.messages },
    ...(patch === null ? {} : { applyPatch: { ...patch.deps, messages: patch.parts.messages } }),
  });
  return Object.freeze<PiFsTools>({
    read: adaptPiReadTool(parts.read, core.read, core.digest),
    edit: adaptPiMutationTool(parts.edit, core.edit),
    write: adaptPiMutationTool(parts.write, core.write),
    applyPatch:
      patch === null || core.applyPatch === null
        ? null
        : adaptPiMutationTool(patch.parts, core.applyPatch),
    state: core.state,
    digest: core.digest,
    locks: core.locks,
    clock: core.clock,
    invalidate: (path, call) => core.invalidate(path, call),
  });
}

function isReadStateStore(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const store = value as Record<string, unknown>;
  return ["get", "put", "delete"].every((key) => typeof store[key] === "function");
}
