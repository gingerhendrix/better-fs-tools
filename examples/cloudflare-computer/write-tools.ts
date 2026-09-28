import type { Workspace } from "@cloudflare/computer";
import { computerFileSystem } from "@better-fs-tools/cloudflare-computer";
import { createMemoryStore, createReadTool } from "@better-fs-tools/read";
import type { Digest } from "@better-fs-tools/read";
import { createEditTool, createWriteTool, memoryLocks } from "@better-fs-tools/write";

// A Digest is synchronous, and a Worker has no node:crypto: pass a pure JavaScript hash.
export function computerTools(workspace: Workspace, digest: Digest) {
  const fs = computerFileSystem(workspace.fs, { root: "/workspace" });
  const shared = { fs, state: createMemoryStore(), digest };
  const locks = memoryLocks();
  return {
    read: createReadTool(shared),
    edit: createEditTool({ ...shared, locks }),
    write: createWriteTool({ ...shared, locks }),
  };
}
