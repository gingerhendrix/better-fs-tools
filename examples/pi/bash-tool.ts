import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiBashTool, piToolRenderers } from "@better-fs-tools/pi";

// Replaces Pi's own bash with the shared signature: { command, timeout?, cwd? },
// the timeout in milliseconds, run in ctx.cwd. Pi's bash renderer still draws it.
export default function bashExtension(pi: ExtensionAPI): void {
  const bash = createPiBashTool();
  pi.registerTool(bash);
  pi.registerToolRenderer(piToolRenderers([bash]));
}
