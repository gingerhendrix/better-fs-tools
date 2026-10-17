// Type tests: tsc checks this file through the package tsconfig; Bun does not run it.
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import { nodeCommandRunner } from "@better-fs-tools/node";
import { shellEnv } from "@better-fs-tools/shell";

import { createPiBashTool } from "../../src/index.ts";
import type { PiBashToolOptions, PiBashDetails } from "../../src/index.ts";
import { piCwdCommandRunner } from "../../src/node.ts";

// @ts-expect-error runner and env are required
createPiBashTool({});
// @ts-expect-error env is required
export const withoutEnv: PiBashToolOptions = { runner: piCwdCommandRunner() };

// The cwd option of createBashTool() type-checks, with the Pi context as host.
createPiBashTool({
  runner: nodeCommandRunner(),
  env: shellEnv(() => process.env),
  cwd: (call) => call.host.cwd,
  limits: { maxTimeoutMs: 2_000 },
});

// PiBashTool is assignable to Pi's ToolDefinition.
export const bashDefinition: ToolDefinition<TSchema, PiBashDetails | undefined> = createPiBashTool({
  runner: piCwdCommandRunner(),
  env: shellEnv(() => process.env),
});
