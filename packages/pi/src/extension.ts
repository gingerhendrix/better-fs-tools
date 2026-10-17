/**
 * Pi package extension entry. Installing the package into a Pi project
 * registers read, edit, and write, which replace Pi's own tools, and nothing
 * else. It uses the recommended Pi configuration: a filesystem rooted at each
 * call's ctx.cwd, Pi's own per-file queue as the locks, so Pi's edit and
 * write wait for these tools, and nodeDigest(), which is faster on Node. Every
 * other option has the shared default: no read store, and read returns images.
 * A renderer resolver lets Pi's built-in read, edit, and write renderers draw
 * them. Nothing is written outside the process: no settings file, no session file.
 */
import type { ToolRendererResolver } from "@earendil-works/pi-coding-agent";

import { nodeDigest } from "@better-fs-tools/node";

import { createPiFsTools } from "./fs-tools.ts";
import { piMutationQueueLocks } from "./locks.ts";
import type { PiMutationTool } from "./mutation-tools.ts";
import { piCwdFileSystem } from "./node.ts";
import { piToolRenderers } from "./renderers.ts";
import type { PiReadTool } from "./tool.ts";

/** The part of Pi's ExtensionAPI this extension uses. Pi's full API satisfies it. */
export interface PiExtensionApi {
  // Two overloads, not a union, so Pi's generic registerTool infers each tool's details type.
  registerTool(tool: PiReadTool): void;
  registerTool(tool: PiMutationTool): void;
  registerToolRenderer(resolver: ToolRendererResolver): void;
}

export default function fsToolsExtension(pi: PiExtensionApi): void {
  const tools = createPiFsTools({
    fs: piCwdFileSystem(),
    locks: piMutationQueueLocks(),
    digest: nodeDigest(),
  });
  pi.registerTool(tools.read);
  pi.registerTool(tools.edit);
  pi.registerTool(tools.write);
  pi.registerToolRenderer(piToolRenderers([tools.read, tools.edit, tools.write]));
}
