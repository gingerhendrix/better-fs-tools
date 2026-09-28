import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiBashTool } from "@better-fs-tools/pi";

// Replaces Pi's own bash: same name, { command, timeout } in seconds, run in ctx.cwd.
export default function bashExtension(pi: ExtensionAPI): void {
  pi.registerTool(createPiBashTool());
}
