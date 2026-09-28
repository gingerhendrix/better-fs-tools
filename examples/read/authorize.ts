import { createNodeReadTool } from "@better-fs-tools/node";
import { askUser, readAuthorizers, denyPaths, sizeCeiling } from "@better-fs-tools/read";

// Your own prompt, for example a dialog in your UI.
declare function confirmInUi(question: string): Promise<boolean>;

export const read = createNodeReadTool({
  authorize: readAuthorizers(
    denyPaths(["**/.env", "**/.env.*", "**/*.pem"]),
    sizeCeiling({ maxBytes: 256 * 1024, unrangedOnly: true }),
    askUser(async (target) => confirmInUi(`Read ${target.displayPath}?`)),
  ),
});
