import { createNodeFsTools, nodeCommandRunner } from "@better-fs-tools/node";
import type { NodeFsToolsWithBash } from "@better-fs-tools/node";

// bash is created only because `bash` is set. The hook makes the next edit of
// package.json need a read first, since a command may have changed it.
let tools: NodeFsToolsWithBash | undefined;
tools = createNodeFsTools({
  cwd: "/srv/project",
  bash: {
    runner: nodeCommandRunner({ cwd: "/srv/project", shell: "/bin/bash" }),
    afterRun: [
      {
        id: "invalidate-package-json",
        afterRun: async (outcome) => {
          const invalidated = await tools?.invalidate("package.json");
          // An empty update keeps the output and the notes.
          if (invalidated === undefined || invalidated.ok) return {};
          const warning = {
            code: "invalidate-failed",
            severity: "warning" as const,
            message: "Read package.json again before you edit it.",
          };
          return { notes: [...outcome.notes, warning] };
        },
      },
    ],
  },
});

export const { read, edit, bash } = tools;
