import type { Workspace } from "@cloudflare/computer";
import { computerFileSystem } from "@better-fs-tools/cloudflare-computer";
import { createReadTool } from "@better-fs-tools/read";

export function computerReadTool(workspace: Workspace) {
  return createReadTool({ fs: computerFileSystem(workspace.fs, { root: "/workspace" }) });
}
