import { nodeFileSystem } from "@better-fs-tools/node";
import { charsPerToken, createReadTool } from "@better-fs-tools/read";

export const read = createReadTool({
  fs: nodeFileSystem({ allowedRoots: [process.cwd()] }),
  limits: { maxLines: 1_000, maxViewBytes: 64 * 1024 },
  budget: charsPerToken({ ratio: 4, max: 25_000 }),
});
