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

import { lineNumberFormatter } from "@better-fs-tools/read";
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

// @ts-expect-error fs is not an option: the root is ctx.cwd
createPiReadTool({ fs: null });
