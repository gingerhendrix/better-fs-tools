import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiFsTools, piToolRenderers } from "@better-fs-tools/pi";
import { piCwdCommandRunner, piCwdFileSystem } from "@better-fs-tools/pi/node";
import { memoryStore } from "@better-fs-tools/read";
import { shellEnv } from "@better-fs-tools/shell";

// The file tools with a read store, and bash in the same bundle. After each
// command, the next edit of package.json needs a read, since the command may
// have changed it.
export default function fsAndBashExtension(pi: ExtensionAPI): void {
  const tools = createPiFsTools({
    fs: piCwdFileSystem(),
    state: memoryStore(),
    bash: {
      runner: piCwdCommandRunner(),
      env: shellEnv(() => process.env),
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
    },
  });
  pi.registerTool(tools.read);
  pi.registerTool(tools.edit);
  pi.registerTool(tools.write);
  pi.registerTool(tools.bash);
  pi.registerToolRenderer(piToolRenderers([tools.read, tools.edit, tools.write, tools.bash]));
}
