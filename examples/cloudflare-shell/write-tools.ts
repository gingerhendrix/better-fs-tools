import type { Workspace } from "@cloudflare/shell";
import {
  createAiSdkEditTool,
  createAiSdkReadTool,
  createAiSdkWriteTool,
} from "@better-fs-tools/ai-sdk";
import { shellWorkspaceFileSystem } from "@better-fs-tools/cloudflare-shell";
import { createMemoryStore, sha256Digest } from "@better-fs-tools/read";
import { memoryLocks } from "@better-fs-tools/write";

// sha256Digest() is plain JavaScript, so it runs in a Worker.
export function workspaceTools(workspace: Workspace) {
  const fs = shellWorkspaceFileSystem(workspace, { root: "/workspace" });
  const shared = { fs, state: createMemoryStore(), digest: sha256Digest() };
  const locks = memoryLocks();
  const read = createAiSdkReadTool(shared);
  const edit = createAiSdkEditTool({ ...shared, locks });
  const write = createAiSdkWriteTool({ ...shared, locks });
  return { [read.name]: read, [edit.name]: edit, [write.name]: write };
}
