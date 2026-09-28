import type { Workspace } from "@cloudflare/computer";
import { cloudflareComputerFileSystem } from "@better-fs-tools/cloudflare-computer";
import { createReadTool } from "@better-fs-tools/read";

export function computerReadTool(workspace: Workspace) {
  return createReadTool({
    fs: cloudflareComputerFileSystem(workspace.fs, { allowedRoots: ["/workspace"] }),
  });
}
