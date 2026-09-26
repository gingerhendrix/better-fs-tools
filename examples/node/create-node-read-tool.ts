import { createNodeReadTool, nodeFileSystem } from "@better-fs-tools/node";
import { textOf } from "@better-fs-tools/read";

// Zero config: rooted at process.cwd(), with SHA-256 observations.
const read = createNodeReadTool();
console.log(textOf(await read({ path: "package.json", limit: 1 }))); // "1|{" and a continue note

// Your own roots and policy.
export const docsOnly = createNodeReadTool({
  fs: nodeFileSystem({
    cwd: "/srv/app",
    allowedRoots: ["/srv/app/docs"],
    denyRoots: ["/srv/app/docs/private"],
    symlinks: "reject",
  }),
});
