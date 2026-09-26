import { createNodeReadTool } from "@better-fs-tools/node";
import { opencodeFormat } from "@better-fs-tools/read/formats";

export const read = createNodeReadTool({ formatter: opencodeFormat() });
