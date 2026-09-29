// Type tests: tsc checks this file through the package tsconfig; Bun does not run it.
import { nodeCommandRunner } from "@better-fs-tools/node";

import { createPiBashTool } from "../../src/index.ts";
import type { CreatePiBashToolOptions } from "../../src/index.ts";

// @ts-expect-error cwd is not a Pi bash option
createPiBashTool({ cwd: "/tmp" });
// @ts-expect-error cwd is not a Pi bash option
export const withCwd: CreatePiBashToolOptions = { cwd: () => "/tmp" };

// A runner and limits still type-check.
createPiBashTool({ runner: nodeCommandRunner(), limits: { maxTimeoutMs: 2_000 } });
