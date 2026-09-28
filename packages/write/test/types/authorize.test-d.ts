/**
 * Type tests for authorizer variance (decision W5). Every authorizer
 * interface has `authorize` as a function property, so TypeScript checks the
 * target type strictly and a read authorizer cannot reach a write tool, not
 * even through a `ToolAuthorizer` variable. `tsc -b` checks this file; Bun
 * never runs it.
 */
import { memoryFileSystem } from "@better-fs-tools/fs";
import { askUser, denyPaths, sizeCeiling } from "@better-fs-tools/read";
import type { ReadAuthorizer, ToolAuthorizer } from "@better-fs-tools/read";

import { createEditTool, createWriteTool, protectPaths } from "../../src/index.ts";
import type { WriteAuthorizer } from "../../src/index.ts";

const fs = memoryFileSystem();

// A tool-neutral authorizer fits every write tool.
export const neutral: ToolAuthorizer<unknown> = denyPaths(["**/.env"]);
export const neutralWrite = createWriteTool({ fs, authorize: neutral });
export const neutralAsWrite: WriteAuthorizer = neutral;

// A write authorizer fits a write tool.
export const protectedEdit = createEditTool({
  fs,
  authorize: protectPaths({ patterns: ["**/.git/**"] }),
});

// The reviewers' route: a zero-byte read ceiling widened to ToolAuthorizer.
// @ts-expect-error: a read authorizer needs a ReadAuthorizeTarget, not any AccessTarget.
export const widened: ToolAuthorizer<unknown> = sizeCeiling({ maxBytes: 0 });

// The direct route stays refused.
// @ts-expect-error: a read authorizer is not a write authorizer.
export const direct = createEditTool({ fs, authorize: sizeCeiling({ maxBytes: 0 }) });

// A read authorizer written by hand is refused the same way.
declare const handWritten: ReadAuthorizer<unknown>;
// @ts-expect-error: a hand-written read authorizer does not fit a write tool.
export const handWrittenWrite = createWriteTool({ fs, authorize: handWritten });

// askUser from read is a read authorizer too.
// @ts-expect-error: askUser gives a read authorizer.
export const asked: WriteAuthorizer<unknown> = askUser(async () => true);

// A write authorizer does not fit the neutral type, since it needs the write fields.
// @ts-expect-error: a write authorizer is not tool-neutral.
export const narrowed: ToolAuthorizer<unknown> = protectPaths({ patterns: ["**/.git/**"] });
