/**
 * Pi package extension entry. `package.json` points `pi.extensions` here, so
 * installing the package into a Pi project registers read, edit, write, and
 * apply_patch, and nothing else. The four tools share one in-memory read
 * store (D27), so edit and write need a read first. Nothing is written
 * outside the process: no settings file, no session file.
 */
import { createPiFsTools } from "./fs-tools.ts";
import type { PiMutationTool } from "./mutation-tools.ts";
import type { PiReadTool } from "./tool.ts";

/**
 * The ExtensionAPI subset this entry uses. Pi's full API satisfies it. Two
 * overloads, not a union, so Pi's generic registerTool infers the details
 * type of each tool.
 */
export interface PiExtensionApi {
  registerTool(tool: PiReadTool): void;
  registerTool(tool: PiMutationTool): void;
}

export default function fsToolsExtension(pi: PiExtensionApi): void {
  const tools = createPiFsTools();
  pi.registerTool(tools.read);
  pi.registerTool(tools.edit);
  pi.registerTool(tools.write);
  pi.registerTool(tools.applyPatch);
}
