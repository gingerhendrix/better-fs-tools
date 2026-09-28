import type { Workspace } from "@cloudflare/shell";
import {
  createAiSdkEditTool,
  createAiSdkReadTool,
  createAiSdkWriteTool,
} from "@better-fs-tools/ai-sdk";
import { shellWorkspaceFileSystem } from "@better-fs-tools/cloudflare-shell";
import type { Digest } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read";
import { memoryLocks } from "@better-fs-tools/write";

// A Digest is synchronous, and a Worker has no node:crypto: pass a pure JavaScript hash.
export function workspaceTools(workspace: Workspace, digest: Digest) {
  const fs = shellWorkspaceFileSystem(workspace, { root: "/workspace" });
  const shared = { fs, state: createMemoryStore(), digest };
  const locks = memoryLocks();
  const read = createAiSdkReadTool(shared);
  const edit = createAiSdkEditTool({ ...shared, locks });
  const write = createAiSdkWriteTool({ ...shared, locks });
  return { [read.name]: read, [edit.name]: edit, [write.name]: write };
}
