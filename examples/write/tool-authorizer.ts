import { compileGlob } from "@better-fs-tools/read";
import type { ToolAuthorizer } from "@better-fs-tools/read";

const generated = compileGlob("**/dist/**");

// Tool-neutral: it sees only the fields every tool's target has.
export const noGenerated: ToolAuthorizer<unknown> = {
  id: "no-generated",
  authorize: (target, ctx) =>
    generated(target.resolvedPath)
      ? {
          allow: false,
          note: {
            code: "denied",
            severity: "warning",
            message: ctx.messages.denied({ path: target.requestedPath, detail: "generated" }),
          },
        }
      : { allow: true },
};
