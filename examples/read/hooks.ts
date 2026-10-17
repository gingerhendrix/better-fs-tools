import { nodeFileSystem } from "@better-fs-tools/node";
import { createReadTool, memoryStore, redact, repeatReadGuard } from "@better-fs-tools/read";

// repeatReadGuard needs a digest: the default sha256Digest() is one.
export const read = createReadTool({
  fs: nodeFileSystem({ allowedRoots: [process.cwd()] }),
  state: memoryStore(),
  hooks: [repeatReadGuard(), redact({ patterns: [/AKIA[0-9A-Z]{16}/g] })],
});
