import { createNodeReadTool } from "@better-fs-tools/node";
import { askUser, authorizers, denyPaths, sizeCeiling } from "@better-fs-tools/read";

// Your own prompt, for example a dialog in your UI.
declare function confirmInUi(question: string): Promise<boolean>;

export const read = createNodeReadTool({
  authorize: authorizers(
    denyPaths(["**/.env", "**/.env.*", "**/*.pem"]),
    sizeCeiling({ maxBytes: 256 * 1024, unrangedOnly: true }),
    askUser(async (target) => confirmInUi(`Read ${target.displayPath}?`)),
  ),
});
