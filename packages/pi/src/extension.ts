/**
 * Pi package extension entry. Installing the package into a Pi project
 * registers read, edit, and write, as Pi's own tools are, and nothing else.
 * There is no read store, so edit and write do not check for a read first.
 * Nothing is written outside the process: no settings file, no session file.
 */
import { createPiFsTools } from "./fs-tools.ts";
import type { PiMutationTool } from "./mutation-tools.ts";
import type { PiReadTool } from "./tool.ts";

/** The part of Pi's ExtensionAPI this extension uses. Pi's full API satisfies it. */
export interface PiExtensionApi {
  // Two overloads, not a union, so Pi's generic registerTool infers each tool's details type.
  registerTool(tool: PiReadTool): void;
  registerTool(tool: PiMutationTool): void;
}

export default function fsToolsExtension(pi: PiExtensionApi): void {
  const tools = createPiFsTools();
  pi.registerTool(tools.read);
  pi.registerTool(tools.edit);
  pi.registerTool(tools.write);
}
