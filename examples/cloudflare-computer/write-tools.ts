import type { Workspace } from "@cloudflare/computer";
import { cloudflareComputerFileSystem } from "@better-fs-tools/cloudflare-computer";
import { createFsTools } from "@better-fs-tools/write";

// One sha256Digest() and one lock manager. createFsTools needs no Node module,
// so it runs in a Worker.
export function computerTools(workspace: Workspace) {
  const fs = cloudflareComputerFileSystem(workspace.fs, { allowedRoots: ["/workspace"] });
  const { read, edit, write } = createFsTools({ fs });
  return { read, edit, write };
}
