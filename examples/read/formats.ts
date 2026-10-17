import { nodeFileSystem } from "@better-fs-tools/node";
import { createReadTool } from "@better-fs-tools/read";
import { opencodeFormat } from "@better-fs-tools/read/formats";

export const read = createReadTool({
  fs: nodeFileSystem({ allowedRoots: [process.cwd()] }),
  formatter: opencodeFormat(),
});
