import { nodeCommandRunner, nodeFileSystem } from "@better-fs-tools/node";
import { memoryStore } from "@better-fs-tools/read";
import { shellEnv } from "@better-fs-tools/shell";
import { createFsTools } from "@better-fs-tools/write";
import type { FsToolsWithBash } from "@better-fs-tools/write";

// bash is created only because `bash` is set. With a read store, the hook makes
// the next edit of package.json need a read first, since a command may have
// changed it.
let tools: FsToolsWithBash | undefined;
tools = createFsTools({
  fs: nodeFileSystem({ cwd: "/srv/project", allowedRoots: ["/srv/project"] }),
  state: memoryStore(),
  bash: {
    runner: nodeCommandRunner({ cwd: "/srv/project", shell: "/bin/bash" }),
    env: shellEnv(() => process.env),
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
