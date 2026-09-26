/**
 * Type tests. `tsc -b` checks this file through the package tsconfig. Bun never
 * runs it: the name does not match Bun's test file pattern.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import {
  askUser,
  authorizers,
  denyPaths,
  lineNumberFormatter,
  sizeCeiling,
} from "@better-fs-tools/read";
import type { Formatter, ReadContext, ReadStateStore } from "@better-fs-tools/read";
import { lineRangeSignature } from "@better-fs-tools/read/signature";

import readToolExtension from "../../src/extension.ts";
import { createPiReadTool } from "../../src/index.ts";
import type { PiReadDetails, PiReadTool } from "../../src/index.ts";

// PiReadTool is assignable to Pi's ToolDefinition, and the entry is an extension factory.
declare const tool: PiReadTool;
export const definition: ToolDefinition<TSchema, PiReadDetails> = tool;
export const factory: ExtensionFactory = readToolExtension;
declare const api: ExtensionAPI;
api.registerTool(tool);

// The host is Pi's ExtensionContext.
const stores = new Map<string, ReadStateStore>();
export const typed = createPiReadTool({
  signature: lineRangeSignature(),
  state: (call) => stores.get(call.host.sessionManager.getSessionId()) ?? null,
});
createPiReadTool({
  // @ts-expect-error ExtensionContext has no session field
  state: (call) => stores.get(call.host.session) ?? null,
});

// Host-free helpers typed with unknown fit the Pi tool.
export const unknownFormatter = createPiReadTool({ formatter: lineNumberFormatter() });
export const unknownState = createPiReadTool({
  state: (_call: ReadContext<unknown>) => null,
});
declare const piFormatter: Formatter<ExtensionContext>;
export const hostFormatter = createPiReadTool({ formatter: piFormatter });

// askUser takes Pi's ExtensionContext as its host, so ctx.call.host.ui type-checks.
export const confirmed = createPiReadTool({
  authorize: askUser((target, ctx) => ctx.call.host.ui.confirm("Read", target.displayPath)),
});
createPiReadTool({
  // @ts-expect-error ExtensionContext has no session field
  authorize: askUser(async (_target, ctx) => ctx.call.host.session),
});

// Host-free and Pi-typed authorizers compose.
export const composed = createPiReadTool({
  authorize: authorizers(
    denyPaths(["**/.env"]),
    sizeCeiling({ maxBytes: 1_000_000, unrangedOnly: true }),
    askUser((target, ctx) => ctx.call.host.ui.confirm("Read", target.displayPath)),
  ),
});

// @ts-expect-error fs is not an option: the root is ctx.cwd
createPiReadTool({ fs: null });
