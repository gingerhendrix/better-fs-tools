/**
 * Type tests for authorizer variance (decision W5). `tsc -b` checks this
 * file; Bun never runs it.
 */
import { denyPaths, sizeCeiling } from "@better-fs-tools/read";
import type { ToolAuthorizer } from "@better-fs-tools/read";

import { createBashTool, shellEnv } from "../../src/index.ts";
import type { CommandRunner, ShellAuthorizer } from "../../src/index.ts";

declare const runner: CommandRunner;

// A tool-neutral authorizer fits the bash tool.
export const neutral: ToolAuthorizer<unknown> = denyPaths(["/etc/**"]);
export const neutralBash = createBashTool({ runner, env: shellEnv(), authorize: neutral });

// @ts-expect-error: a read authorizer cannot be widened to ToolAuthorizer.
export const widened: ToolAuthorizer<unknown> = sizeCeiling({ maxBytes: 0 });
// @ts-expect-error: a read authorizer is not a shell authorizer.
export const direct: ShellAuthorizer<unknown> = sizeCeiling({ maxBytes: 0 });

// A shell authorizer written as an object with a method still fits.
export const host: ShellAuthorizer = {
  id: "no-rm",
  authorize(target) {
    return target.command.includes("rm ") ? { allow: false } : { allow: true };
  },
};
