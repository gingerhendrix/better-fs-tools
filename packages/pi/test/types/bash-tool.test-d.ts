/**
 * Type tests. `tsc -b` checks this file through the package tsconfig. Bun never
 * runs it: the name does not match Bun's test file pattern.
 */
import { nodeCommandRunner } from "@better-fs-tools/node";

import { createPiBashTool } from "../../src/index.ts";
import type { CreatePiBashToolOptions } from "../../src/index.ts";

// The directory is bound to ctx.cwd, so the options type has no cwd.
// @ts-expect-error cwd is not a Pi bash option
createPiBashTool({ cwd: "/tmp" });
// @ts-expect-error cwd is not a Pi bash option
export const withCwd: CreatePiBashToolOptions = { cwd: () => "/tmp" };

// A runner and limits still type-check.
createPiBashTool({ runner: nodeCommandRunner(), limits: { maxTimeoutMs: 2_000 } });
