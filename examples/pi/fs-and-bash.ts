import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiBashTool, createPiFsTools, piToolRenderers } from "@better-fs-tools/pi";
import { memoryStore } from "@better-fs-tools/read";

// The file tools with a read store, and bash. After each command,
// the next edit of package.json needs a read, since the command may have
// changed it.
export default function fsAndBashExtension(pi: ExtensionAPI): void {
  const tools = createPiFsTools({ state: memoryStore() });
  const bash = createPiBashTool({
    afterRun: [
      {
        id: "invalidate-package-json",
        afterRun: async (_outcome, ctx) => {
          // ctx.call carries Pi's ctx, so the path resolves under its cwd.
          await tools.invalidate("package.json", ctx.call);
          return {};
        },
      },
    ],
  });
  pi.registerTool(tools.read);
  pi.registerTool(tools.edit);
  pi.registerTool(tools.write);
  pi.registerTool(bash);
  pi.registerToolRenderer(piToolRenderers([tools.read, tools.edit, tools.write, bash]));
}
