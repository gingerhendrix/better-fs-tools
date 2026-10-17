import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiFsTools, piMutationQueueLocks, piToolRenderers } from "@better-fs-tools/pi";
import { piCwdFileSystem } from "@better-fs-tools/pi/node";
import { nodeDigest } from "@better-fs-tools/node";
import { denyPaths, memoryStore, unicodeRepair } from "@better-fs-tools/read";
import { hashlineFormat } from "@better-fs-tools/read/formats";
import { protectPaths } from "@better-fs-tools/write";

export default function fsToolsExtension(pi: ExtensionAPI): void {
  const tools = createPiFsTools({
    // The recommended Pi configuration, as in the package's extension entry.
    fs: piCwdFileSystem(), // a Node filesystem rooted at ctx.cwd on each call
    locks: piMutationQueueLocks(), // the per-file queue of Pi's own edit and write
    digest: nodeDigest(), // faster on Node than the default sha256Digest()
    // Opt-ins: one read store, so edit and write need a read first, and apply_patch.
    state: memoryStore(),
    read: {
      resolve: unicodeRepair({ note: false }),
      authorize: denyPaths(["**/.env", "**/.env.*"]),
      formatter: hashlineFormat(),
    },
    edit: { authorize: protectPaths() },
    write: { authorize: protectPaths() },
    applyPatch: { authorize: protectPaths() },
  });
  pi.registerTool(tools.read);
  pi.registerTool(tools.edit);
  pi.registerTool(tools.write);
  pi.registerTool(tools.applyPatch);
  // Pi's built-in read, edit, and write renderers draw the shared signatures.
  pi.registerToolRenderer(piToolRenderers([tools.read, tools.edit, tools.write]));
}
