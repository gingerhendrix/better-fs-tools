import type { Workspace } from "@cloudflare/computer";
import { computerFileSystem } from "@better-fs-tools/cloudflare-computer";
import { createMemoryStore, createReadTool, sha256Digest } from "@better-fs-tools/read";
import { createEditTool, createWriteTool, memoryLocks } from "@better-fs-tools/write";

// sha256Digest() is plain JavaScript, so it runs in a Worker.
export function computerTools(workspace: Workspace) {
  const fs = computerFileSystem(workspace.fs, { root: "/workspace" });
  const shared = { fs, state: createMemoryStore(), digest: sha256Digest() };
  const locks = memoryLocks();
  return {
    read: createReadTool(shared),
    edit: createEditTool({ ...shared, locks }),
    write: createWriteTool({ ...shared, locks }),
  };
}
