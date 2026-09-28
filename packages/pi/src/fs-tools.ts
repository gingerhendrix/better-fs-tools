import { nodeDigest } from "@better-fs-tools/node";
import type { ReadStateStore } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";
import { memoryLocks } from "@better-fs-tools/write";

import { buildPiApplyPatchTool, buildPiEditTool, buildPiWriteTool } from "./mutation-tools.ts";
import type {
  CreatePiApplyPatchToolOptions,
  CreatePiEditToolOptions,
  CreatePiWriteToolOptions,
  PiMutationTool,
} from "./mutation-tools.ts";
import { checkPiOptions, piFileSystems } from "./roots.ts";
import type { PiRootOptions } from "./roots.ts";
import { buildPiReadTool } from "./tool.ts";
import type { CreatePiReadToolOptions, PiReadTool } from "./tool.ts";

/** Set once for all four tools. */
type Shared = "state" | "digest" | "locks" | keyof PiRootOptions;

const KNOWN = new Set([
  "state",
  "denyRoots",
  "symlinks",
  "hardLinks",
  "read",
  "edit",
  "write",
  "applyPatch",
]);
const SHARED_KEYS = ["state", "digest", "locks", "denyRoots", "symlinks", "hardLinks"] as const;

export interface CreatePiFsToolsOptions extends PiRootOptions {
  /** Default createMemoryStore(). null turns read-before-write off. */
  readonly state?: ReadStateStore | null;
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
}

/**
 * Four tools with one store, one digest (nodeDigest()), one lock manager, and
 * one root cache over ctx.cwd. Throws TypeError on fs, cwd, or allowedRoots,
 * at the top level or in any tool's options, on an unknown top-level key, and
 * on a shared option (state, digest, locks, or a root option) in a tool's options.
 */
export function createPiFsTools(options: CreatePiFsToolsOptions = {}): PiFsTools {
  checkPiOptions(options, "fs");
  for (const key of Object.keys(options)) {
    if (!KNOWN.has(key)) throw new TypeError(`Unknown createPiFsTools option: ${key}`);
  }
  const { state: given, denyRoots, symlinks, hardLinks } = options;
  const parts = {
    read: options.read ?? {},
    edit: options.edit ?? {},
    write: options.write ?? {},
    applyPatch: options.applyPatch ?? {},
  };
  for (const [key, value] of Object.entries(parts)) {
    checkPiOptions(value, key);
    for (const shared of SHARED_KEYS) {
      if (Object.hasOwn(value, shared)) {
        throw new TypeError(
          `createPiFsTools ${key} options cannot set ${shared}: set it once at the top level`,
        );
      }
    }
  }

  const fileSystemFor = piFileSystems({ denyRoots, symlinks, hardLinks });
  const shared = {
    state: given === undefined ? createMemoryStore() : given,
    digest: nodeDigest(),
  };
  const locks = memoryLocks();
  return Object.freeze<PiFsTools>({
    read: buildPiReadTool({ ...parts.read, ...shared }, fileSystemFor),
    edit: buildPiEditTool({ ...parts.edit, ...shared, locks }, fileSystemFor),
    write: buildPiWriteTool({ ...parts.write, ...shared, locks }, fileSystemFor),
    applyPatch: buildPiApplyPatchTool({ ...parts.applyPatch, ...shared, locks }, fileSystemFor),
  });
}
