import type { ReadAuthorizer } from "@better-fs-tools/read";

export const noLockfiles: ReadAuthorizer<unknown> = {
  id: "no-lockfiles",
  authorize: (target, ctx) =>
    target.action === "read" && target.resolvedPath.endsWith(".lock")
      ? {
          allow: false,
          note: {
            code: "denied",
            severity: "warning",
            message: ctx.messages.denied({
              path: target.requestedPath,
              detail: "lockfiles are off",
            }),
          },
        }
      : { allow: true },
};
