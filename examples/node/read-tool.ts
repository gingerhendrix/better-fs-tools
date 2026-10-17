import { nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { createReadTool, textOf } from "@better-fs-tools/read";

// The local filesystem, rooted at process.cwd(). nodeDigest() is optional: it
// gives the same values as the default sha256Digest(), faster, on node:crypto.
const cwd = process.cwd();
const read = createReadTool({
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
  digest: nodeDigest(),
});
console.log(textOf(await read({ path: "package.json", limit: 1 }))); // "1|{" and a continue note

// Your own roots and policy.
export const docsOnly = createReadTool({
  fs: nodeFileSystem({
    cwd: "/srv/app",
    allowedRoots: ["/srv/app/docs"],
    denyRoots: ["/srv/app/docs/private"],
    symlinks: "reject",
  }),
});
