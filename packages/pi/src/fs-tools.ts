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
  PiMutationTool,
} from "./mutation-tools.ts";
import { checkPiOptions, PI_ROOT_KEYS, piFileSystems } from "./roots.ts";
import type { PiRootOptions } from "./roots.ts";
import { adaptPiReadTool, piReadDeps, piReadParts } from "./tool.ts";
import type { CreatePiReadToolOptions, PiReadTool } from "./tool.ts";

/** Set once for all four tools. */
type Shared = FsToolsSharedKey | keyof PiRootOptions;

const KNOWN: ReadonlySet<string> = new Set([
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
const SHARED_KEYS = ["state", "digest", "locks", "clock", ...PI_ROOT_KEYS] as const;

export interface CreatePiFsToolsOptions extends PiRootOptions {
  /** Default memoryStore({ clock }), on the bundle clock. null turns read-before-write off. */
  readonly state?: ReadStateStore | null;
  /** Default nodeDigest(), as in createNodeFsTools. */
  readonly digest?: Digest;
  /** Default memoryLocks(). */
  readonly locks?: LockManager;
  /** Default () => new Date(). */
  readonly clock?: Clock;
  readonly read?: Omit<CreatePiReadToolOptions, Shared>;
  readonly edit?: Omit<CreatePiEditToolOptions, Shared>;
  readonly write?: Omit<CreatePiWriteToolOptions, Shared>;
  readonly applyPatch?: Omit<CreatePiApplyPatchToolOptions, Shared>;
}

export interface PiFsTools {
  readonly read: PiReadTool;
  readonly edit: PiMutationTool;
  readonly write: PiMutationTool;
  readonly applyPatch: PiMutationTool;
  readonly state: ReadStateStore | null;
  /** options.digest, or nodeDigest(). */
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /**
   * Deletes the record for a path under the call's ctx.cwd, so the next edit
   * needs a read. Pass the call: in a bash afterRun hook it is ctx.call.
   * Without it there is no ctx.cwd, so the outcome is { ok: false } with
   * reason "unsupported", as in the portable bundle over an fs factory.
   * Never throws. With state null it still stats, and reports recorded: false.
   */
  invalidate(path: string, call?: ToolCallContext<ExtensionContext>): Promise<InvalidateOutcome>;
}

/**
 * createFsTools from @better-fs-tools/write, over one root cache on ctx.cwd,
 * with nodeDigest(). The four tools share one store, one digest, one lock
 * manager, and one clock. Throws TypeError on fs, cwd, or allowedRoots, at
 * the top level or in any tool's options, on an unknown top-level key, and
 * on a shared option (state, digest, locks, clock, or a root option) in a
 * tool's options. No bash: register createPiBashTool() for that, and call
 * invalidate from its afterRun hook.
 */
export function createPiFsTools(options: CreatePiFsToolsOptions = {}): PiFsTools {
  checkPiOptions(options, "fs");
  for (const key of Object.keys(options)) {
    if (!KNOWN.has(key)) throw new TypeError(`Unknown createPiFsTools option: ${key}`);
  }
  const state: unknown = (options as Record<string, unknown>).state;
  if (state !== undefined && state !== null && !isStore(state)) {
    throw new TypeError(
      `createPiFsTools state must be a read state store or null: a bundle takes one store, not a per-call factory`,
    );
  }
  const given = {
    read: options.read ?? {},
    edit: options.edit ?? {},
    write: options.write ?? {},
    applyPatch: options.applyPatch ?? {},
  };
  for (const [key, value] of Object.entries(given)) {
    checkPiOptions(value, key);
    for (const shared of SHARED_KEYS) {
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
  const {
    signature: _patchSignature,
    promptSnippet: _patchSnippet,
    promptGuidelines: _patchLines,
    ...applyPatch
  } = given.applyPatch;
  const parts = {
    read: piReadParts(given.read),
    edit: piEditParts(given.edit),
    write: piWriteParts(given.write),
    applyPatch: piApplyPatchParts(given.applyPatch),
  };

  const core = createFsTools<ExtensionContext>({
    fs,
    digest: options.digest ?? nodeDigest(),
    ...(options.state === undefined ? {} : { state: options.state }),
    ...(options.locks === undefined ? {} : { locks: options.locks }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    read: { ...read, ...piReadDeps(parts.read) },
    edit: { ...edit, messages: parts.edit.messages },
    write: { ...write, messages: parts.write.messages },
    applyPatch: { ...applyPatch, messages: parts.applyPatch.messages },
  });
  return Object.freeze<PiFsTools>({
    read: adaptPiReadTool(parts.read, core.read, core.digest),
    edit: adaptPiMutationTool(parts.edit, core.edit),
    write: adaptPiMutationTool(parts.write, core.write),
    applyPatch: adaptPiMutationTool(parts.applyPatch, core.applyPatch),
    state: core.state,
    digest: core.digest,
    locks: core.locks,
    clock: core.clock,
    invalidate: (path, call) => core.invalidate(path, call),
  });
}

/** A read state store: an object with get, put, and delete. A per-call factory is not one. */
function isStore(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const store = value as Record<string, unknown>;
  return ["get", "put", "delete"].every((key) => typeof store[key] === "function");
}
