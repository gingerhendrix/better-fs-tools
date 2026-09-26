/**
 * Pi package extension entry. `package.json` points `pi.extensions` here, so
 * installing the package into a Pi project registers the tool and nothing else.
 * The default tool is stateless: no store, no settings file, no session file.
 */
import { createPiReadTool } from "./tool.ts";
import type { PiReadTool } from "./tool.ts";

/** The ExtensionAPI subset this entry uses. Pi's full API satisfies it. */
export interface PiExtensionApi {
  registerTool(tool: PiReadTool): void;
}

export default function readToolExtension(pi: PiExtensionApi): void {
  pi.registerTool(createPiReadTool());
}
