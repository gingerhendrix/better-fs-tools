import { createApplyPatchTool, createEditTool, createWriteTool } from "@better-fs-tools/write";
import type {
  ApplyPatchTool,
  ApplyPatchToolDeps,
  EditTool,
  EditToolDeps,
  WriteTool,
  WriteToolDeps,
} from "@better-fs-tools/write";

import type { StateNeedsDigest } from "@better-fs-tools/read";

import { nodeDigest } from "./digest.ts";
import { nodeFileSystem } from "./filesystem.ts";

/**
 * The zero-config local edit tool. `fs` defaults to nodeFileSystem rooted at
 * process.cwd(). `digest` defaults to nodeDigest(); pass `digest: null` to
 * turn it off. `state` stays null, so read-before-write is off: use
 * createNodeFsTools() for a store shared with read.
 */
export function createNodeEditTool<THost = undefined>(
  deps: Partial<EditToolDeps<THost>> = {},
): EditTool<THost> {
  return createEditTool<THost>(withNodeDefaults(deps, "edit"));
}

/** The zero-config local write tool. Defaults as createNodeEditTool. */
export function createNodeWriteTool<THost = undefined>(
  deps: Partial<WriteToolDeps<THost>> = {},
): WriteTool<THost> {
  return createWriteTool<THost>(withNodeDefaults(deps, "write"));
}

/** The zero-config local apply_patch tool. Defaults as createNodeEditTool. */
export function createNodeApplyPatchTool<THost = undefined>(
  deps: Partial<ApplyPatchToolDeps<THost>> = {},
): ApplyPatchTool<THost> {
  return createApplyPatchTool<THost>(withNodeDefaults(deps, "apply_patch"));
}

function withNodeDefaults<D extends Partial<WriteToolDeps<never>>>(
  deps: D,
  tool: string,
): D & { fs: NonNullable<D["fs"]> } & StateNeedsDigest {
  if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
    throw new TypeError(`${tool} tool dependencies must be an object`);
  }
  const { fs, digest } = deps;
  // digest defaults to nodeDigest(). The core checks at run time that a state comes with a digest.
  return {
    ...deps,
    fs: fs ?? defaultFileSystem(),
    digest: digest === undefined ? nodeDigest() : digest,
  } as D & { fs: NonNullable<D["fs"]> } & StateNeedsDigest;
}

function defaultFileSystem() {
  const cwd = process.cwd();
  return nodeFileSystem({ cwd, allowedRoots: [cwd] });
}
