import { createApplyPatchTool, createEditTool, createWriteTool } from "@better-fs-tools/write";
import type {
  ApplyPatchTool,
  ApplyPatchToolDeps,
  EditTool,
  EditToolDeps,
  WriteTool,
  WriteToolDeps,
} from "@better-fs-tools/write";

import type { StateNeedsDigestOrDefault } from "@better-fs-tools/read";

import { nodeDigest } from "./digest.ts";
import { nodeFileSystem } from "./filesystem.ts";
import type { NodeFileSystem } from "./filesystem.ts";

/** The edit tool's dependencies, all optional. A state needs a digest that is not null. */
export type CreateNodeEditToolOptions<THost = undefined> = Partial<EditToolDeps<THost>> &
  StateNeedsDigestOrDefault;
/** As CreateNodeEditToolOptions, for write. */
export type CreateNodeWriteToolOptions<THost = undefined> = Partial<WriteToolDeps<THost>> &
  StateNeedsDigestOrDefault;
/** As CreateNodeEditToolOptions, for apply_patch. */
export type CreateNodeApplyPatchToolOptions<THost = undefined> = Partial<
  ApplyPatchToolDeps<THost>
> &
  StateNeedsDigestOrDefault;

/**
 * The zero-config local edit tool. `fs` defaults to nodeFileSystem rooted at
 * process.cwd(). `digest` defaults to nodeDigest(); pass `digest: null` to
 * turn it off. `state` stays null, so read-before-write is off: use
 * createNodeFsTools() for a store shared with read.
 */
export function createNodeEditTool<THost = undefined>(
  deps: CreateNodeEditToolOptions<THost> = {},
): EditTool<THost> {
  checkDeps(deps, "edit");
  const fs = deps.fs ?? defaultFileSystem();
  // digest: null narrows the options to the branch without a state.
  if (deps.digest === null) return createEditTool<THost>({ ...deps, fs, digest: null });
  return createEditTool<THost>({ ...deps, fs, digest: deps.digest ?? nodeDigest() });
}

/** The zero-config local write tool. Defaults as createNodeEditTool. */
export function createNodeWriteTool<THost = undefined>(
  deps: CreateNodeWriteToolOptions<THost> = {},
): WriteTool<THost> {
  checkDeps(deps, "write");
  const fs = deps.fs ?? defaultFileSystem();
  if (deps.digest === null) return createWriteTool<THost>({ ...deps, fs, digest: null });
  return createWriteTool<THost>({ ...deps, fs, digest: deps.digest ?? nodeDigest() });
}

/** The zero-config local apply_patch tool. Defaults as createNodeEditTool. */
export function createNodeApplyPatchTool<THost = undefined>(
  deps: CreateNodeApplyPatchToolOptions<THost> = {},
): ApplyPatchTool<THost> {
  checkDeps(deps, "apply_patch");
  const fs = deps.fs ?? defaultFileSystem();
  if (deps.digest === null) return createApplyPatchTool<THost>({ ...deps, fs, digest: null });
  return createApplyPatchTool<THost>({ ...deps, fs, digest: deps.digest ?? nodeDigest() });
}

function checkDeps(deps: unknown, tool: string): void {
  if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
    throw new TypeError(`${tool} tool dependencies must be an object`);
  }
}

function defaultFileSystem(): NodeFileSystem {
  const cwd = process.cwd();
  return nodeFileSystem({ cwd, allowedRoots: [cwd] });
}
