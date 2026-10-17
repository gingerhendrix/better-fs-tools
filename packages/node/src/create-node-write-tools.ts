import { createApplyPatchTool, createEditTool, createWriteTool } from "@better-fs-tools/write";
import type {
  ApplyPatchTool,
  ApplyPatchToolOptions,
  EditTool,
  EditToolOptions,
  WriteTool,
  WriteToolOptions,
} from "@better-fs-tools/write";

import type { StateNeedsDigest } from "@better-fs-tools/read";

import { nodeDigest } from "./digest.ts";
import { nodeFileSystem } from "./filesystem.ts";
import type { NodeFileSystem } from "./filesystem.ts";

/** Options for createNodeEditTool, all optional. A `state` needs a digest that is not null. */
export type CreateNodeEditToolOptions<THost = undefined> = Partial<EditToolOptions<THost>> &
  StateNeedsDigest;
/** As CreateNodeEditToolOptions, for write. */
export type CreateNodeWriteToolOptions<THost = undefined> = Partial<WriteToolOptions<THost>> &
  StateNeedsDigest;
/** As CreateNodeEditToolOptions, for apply_patch. */
export type CreateNodeApplyPatchToolOptions<THost = undefined> = Partial<
  ApplyPatchToolOptions<THost>
> &
  StateNeedsDigest;

/**
 * Creates an edit tool for local files. `fs` defaults to nodeFileSystem rooted
 * at process.cwd(). `digest` defaults to nodeDigest(); pass `digest: null` to
 * turn it off. Read-before-write is off unless you pass a `state`. For a store
 * shared with read, use createFsTools({ fs: nodeFileSystem(), state }) from
 * @better-fs-tools/write.
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

/** Creates a write tool for local files, with the same defaults as createNodeEditTool. */
export function createNodeWriteTool<THost = undefined>(
  deps: CreateNodeWriteToolOptions<THost> = {},
): WriteTool<THost> {
  checkDeps(deps, "write");
  const fs = deps.fs ?? defaultFileSystem();
  if (deps.digest === null) return createWriteTool<THost>({ ...deps, fs, digest: null });
  return createWriteTool<THost>({ ...deps, fs, digest: deps.digest ?? nodeDigest() });
}

/** Creates an apply_patch tool for local files, with the same defaults as createNodeEditTool. */
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
    throw new TypeError(`${tool} tool options must be an object`);
  }
}

function defaultFileSystem(): NodeFileSystem {
  const cwd = process.cwd();
  return nodeFileSystem({ cwd, allowedRoots: [cwd] });
}
