import type { Workspace } from "@cloudflare/shell";
import { createAiSdkFsTools } from "@better-fs-tools/ai-sdk";
import { cloudflareShellFileSystem } from "@better-fs-tools/cloudflare-shell";

// read, edit, write, and apply_patch with one store, one sha256Digest(), and
// one lock manager. Nothing here needs Node, so it runs in a Worker.
export function workspaceTools(workspace: Workspace) {
  const fs = cloudflareShellFileSystem(workspace, { allowedRoots: ["/workspace"] });
  return createAiSdkFsTools({ fs }).tools;
}
