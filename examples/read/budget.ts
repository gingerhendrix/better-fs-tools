import { createNodeReadTool } from "@better-fs-tools/node";
import { charsPerToken } from "@better-fs-tools/read";

export const read = createNodeReadTool({
  limits: { maxLines: 1_000, maxViewBytes: 64 * 1024 },
  budget: charsPerToken({ ratio: 4, max: 25_000 }),
});
