import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiFsTools } from "@better-fs-tools/pi";
import { denyPaths, memoryStore, unicodeRepair } from "@better-fs-tools/read";
import { hashlineFormat } from "@better-fs-tools/read/formats";
import { protectPaths } from "@better-fs-tools/write";

export default function fsToolsExtension(pi: ExtensionAPI): void {
  // Four tools with one read store, so edit and write need a read first. The
  // store and apply_patch are opt-in.
  const tools = createPiFsTools({
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
}
