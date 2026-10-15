/**
 * Pi package extension entry. Installing the package into a Pi project
 * registers read, edit, and write, which replace Pi's own tools, and nothing
 * else. The tools take the shared default signatures of every integration.
 * A renderer resolver lets Pi's built-in read, edit, and write renderers
 * draw them. There is no read store, so edit and write do not check for a
 * read first. read returns images.
 * Nothing is written outside the process: no settings file, no session file.
 */
import type { ToolRendererResolver } from "@earendil-works/pi-coding-agent";

import { createPiFsTools } from "./fs-tools.ts";
import type { PiMutationTool } from "./mutation-tools.ts";
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
  const tools = createPiFsTools();
  pi.registerTool(tools.read);
  pi.registerTool(tools.edit);
  pi.registerTool(tools.write);
  pi.registerToolRenderer(piToolRenderers([tools.read, tools.edit, tools.write]));
}
