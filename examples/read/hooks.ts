import { createNodeReadTool } from "@better-fs-tools/node";
import { redact, repeatReadGuard } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";

// createNodeReadTool sets digest to nodeDigest(), which repeatReadGuard needs.
export const read = createNodeReadTool({
  state: createMemoryStore(),
  hooks: [repeatReadGuard(), redact({ patterns: [/AKIA[0-9A-Z]{16}/g] })],
});
