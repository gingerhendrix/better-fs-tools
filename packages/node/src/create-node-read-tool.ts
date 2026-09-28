import { createReadTool } from "@better-fs-tools/read";
import type { ReadTool, ReadToolDeps, StateNeedsDigest } from "@better-fs-tools/read";

import { nodeDigest } from "./digest.ts";
import { nodeFileSystem } from "./filesystem.ts";

/**
 * The zero-config local reader. `fs` defaults to nodeFileSystem rooted at
 * process.cwd(). `digest` defaults to nodeDigest(); pass `digest: null` to turn
 * observations off. Every other dependency keeps the core default.
 */
export function createNodeReadTool<THost = undefined>(
  deps: Partial<ReadToolDeps<THost>> = {},
): ReadTool<THost> {
  if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
    throw new TypeError("read tool dependencies must be an object");
  }
  const { fs, digest, ...rest } = deps;
  // digest defaults to nodeDigest(). The core checks at run time that a state comes with a digest.
  return createReadTool<THost>({
    ...rest,
    fs: fs ?? defaultFileSystem(),
    digest: digest === undefined ? nodeDigest() : digest,
  } as ReadToolDeps<THost> & StateNeedsDigest);
}

function defaultFileSystem() {
  const cwd = process.cwd();
  return nodeFileSystem({ cwd, allowedRoots: [cwd] });
}
