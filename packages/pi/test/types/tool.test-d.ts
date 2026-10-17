// Type tests: tsc checks this file through the package tsconfig; Bun does not run it.
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import {
  askUser,
  denyPaths,
  lineNumberFormatter,
  readAuthorizers,
  sizeCeiling,
} from "@better-fs-tools/read";
import type { ReadFormatter, ReadContext, ReadStateStore } from "@better-fs-tools/read";
import {
  deepAgentsFormat,
  hashlineFormat,
  hermesFormat,
  opencodeFormat,
} from "@better-fs-tools/read/formats";
import { defaultReadSignature } from "@better-fs-tools/read/signature";

import readToolExtension from "../../src/extension.ts";
import { createPiReadTool } from "../../src/index.ts";
import type { PiReadDetails, PiReadTool } from "../../src/index.ts";
import { piCwdFileSystem } from "../../src/node.ts";

// PiReadTool is assignable to Pi's ToolDefinition, and the entry is an extension factory.
declare const tool: PiReadTool;
export const definition: ToolDefinition<TSchema, PiReadDetails> = tool;
export const factory: ExtensionFactory = readToolExtension;
declare const api: ExtensionAPI;
api.registerTool(tool);

// The host is Pi's ExtensionContext.
const stores = new Map<string, ReadStateStore>();
export const typed = createPiReadTool({
  fs: piCwdFileSystem(),
  signature: defaultReadSignature({ name: "view" }),
  state: (call) => stores.get(call.host.sessionManager.getSessionId()) ?? null,
});
createPiReadTool({
  fs: piCwdFileSystem(),
  // @ts-expect-error ExtensionContext has no session field
  state: (call) => stores.get(call.host.session) ?? null,
});

// Host-free helpers typed with unknown fit the Pi tool.
export const unknownFormatter = createPiReadTool({
  fs: piCwdFileSystem(),
  formatter: lineNumberFormatter(),
});
export const unknownState = createPiReadTool({
  fs: piCwdFileSystem(),
  state: (_call: ReadContext<unknown>) => null,
});
declare const piFormatter: ReadFormatter<ExtensionContext>;
export const hostFormatter = createPiReadTool({ fs: piCwdFileSystem(), formatter: piFormatter });

// askUser takes Pi's ExtensionContext as its host, so ctx.call.host.ui type-checks.
export const confirmed = createPiReadTool({
  fs: piCwdFileSystem(),
  authorize: askUser((target, ctx) => ctx.call.host.ui.confirm("Read", target.displayPath)),
});
createPiReadTool({
  fs: piCwdFileSystem(),
  // @ts-expect-error ExtensionContext has no session field
  authorize: askUser(async (_target, ctx) => ctx.call.host.session),
});

// Host-free and Pi-typed authorizers compose.
export const composed = createPiReadTool({
  fs: piCwdFileSystem(),
  authorize: readAuthorizers(
    denyPaths(["**/.env"]),
    sizeCeiling({ maxBytes: 1_000_000, unrangedOnly: true }),
    askUser((target, ctx) => ctx.call.host.ui.confirm("Read", target.displayPath)),
  ),
});

// @ts-expect-error fs is required
createPiReadTool({});

// Each ./formats preset fits the Pi tool, whose host is ExtensionContext.
export const presets: PiReadTool[] = [
  opencodeFormat(),
  deepAgentsFormat(),
  hashlineFormat(),
  hermesFormat(),
].map((formatter) => createPiReadTool({ fs: piCwdFileSystem(), formatter }));
export const presetAsPiFormatter: ReadFormatter<ExtensionContext> = hashlineFormat();

// The state and digest pairing is in the options type (StateNeedsDigest).
declare const pairedStore: ReadStateStore;
export const pairedRead = createPiReadTool({ fs: piCwdFileSystem(), state: pairedStore });
// @ts-expect-error: a state needs a digest that is not null.
createPiReadTool({ fs: piCwdFileSystem(), state: pairedStore, digest: null });
