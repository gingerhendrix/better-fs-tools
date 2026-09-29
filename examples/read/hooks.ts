import { createNodeReadTool } from "@better-fs-tools/node";
import { memoryStore, redact, repeatReadGuard } from "@better-fs-tools/read";

// createNodeReadTool sets digest to nodeDigest(), which repeatReadGuard needs.
export const read = createNodeReadTool({
  state: memoryStore(),
  hooks: [repeatReadGuard(), redact({ patterns: [/AKIA[0-9A-Z]{16}/g] })],
});
