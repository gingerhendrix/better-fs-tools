import { createReadTool } from "@better-fs-tools/read";
import type { ReadTool, ReadToolDeps, StateNeedsDigestOrDefault } from "@better-fs-tools/read";

import { nodeDigest } from "./digest.ts";
import { nodeFileSystem } from "./filesystem.ts";

/** Options for createNodeReadTool, all optional. A `state` needs a digest that is not null. */
export type CreateNodeReadToolOptions<THost = undefined> = Partial<ReadToolDeps<THost>> &
  StateNeedsDigestOrDefault;

/**
 * Creates a read tool for local files. `fs` defaults to nodeFileSystem rooted
 * at process.cwd(). `digest` defaults to nodeDigest(); pass `digest: null` to
 * turn observations off.
 */
export function createNodeReadTool<THost = undefined>(
  deps: CreateNodeReadToolOptions<THost> = {},
): ReadTool<THost> {
  if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
    throw new TypeError("read tool dependencies must be an object");
  }
  const fs = deps.fs ?? defaultFileSystem();
  // digest: null narrows the options to the branch without a state.
  if (deps.digest === null) return createReadTool<THost>({ ...deps, fs, digest: null });
  return createReadTool<THost>({ ...deps, fs, digest: deps.digest ?? nodeDigest() });
}

function defaultFileSystem() {
  const cwd = process.cwd();
  return nodeFileSystem({ cwd, allowedRoots: [cwd] });
}
