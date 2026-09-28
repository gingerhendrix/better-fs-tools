import { createNodeFsTools, nodeCommandRunner } from "@better-fs-tools/node";

// The four file tools and bash in one cwd. The hook makes the next edit of a
// file that a command may have changed need a read first.
let tools: ReturnType<typeof createNodeFsTools> | undefined;
tools = createNodeFsTools({
  cwd: "/srv/project",
  bash: {
    runner: nodeCommandRunner({ cwd: "/srv/project", shell: "/bin/bash" }),
    afterRun: [
      {
        id: "invalidate-package-json",
        afterRun: async (outcome) => {
          await tools?.invalidate("package.json");
          return outcome;
        },
      },
    ],
  },
});

export const { read, edit, bash } = tools;
