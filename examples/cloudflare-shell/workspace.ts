import type { Workspace } from "@cloudflare/shell";
import { createAiSdkReadTool } from "@better-fs-tools/ai-sdk";
import { shellWorkspaceFileSystem } from "@better-fs-tools/cloudflare-shell";

export function workspaceReadTool(workspace: Workspace) {
  return createAiSdkReadTool({
    fs: shellWorkspaceFileSystem(workspace, { root: "/workspace" }),
  });
}
