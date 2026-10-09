// Type tests: tsc checks this file through the package tsconfig; Bun does not run it.
import type {
  EditToolDetails,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import type { ReadStateStore, ToolCallContext } from "@better-fs-tools/read";
import { askBeforeWrite, protectPaths, writeAuthorizers } from "@better-fs-tools/write";
import type { Guard, WriteHook } from "@better-fs-tools/write";
import { camelCaseEditSignature, defaultPatchSignature } from "@better-fs-tools/write/signature";

import {
  createPiApplyPatchTool,
  createPiEditTool,
  createPiFsTools,
  createPiWriteTool,
} from "../../src/index.ts";
import type { PiMutationDetails, PiMutationTool } from "../../src/index.ts";

// PiMutationTool is assignable to Pi's ToolDefinition, and Pi's API registers it.
declare const tool: PiMutationTool;
export const definition: ToolDefinition<TSchema, PiMutationDetails | undefined> = tool;
declare const api: ExtensionAPI;
api.registerTool(tool);
const tools = createPiFsTools({ applyPatch: true });
api.registerTool(tools.read);
api.registerTool(tools.edit);
api.registerTool(tools.write);
api.registerTool(tools.applyPatch);

// The details fit Pi's EditToolDetails, both ways.
declare const details: PiMutationDetails;
export const asPiDetails: EditToolDetails = details;
declare const piDetails: EditToolDetails;
export const fromPiDetails: PiMutationDetails = piDetails;

// The host is Pi's ExtensionContext.
const stores = new Map<string, ReadStateStore>();
export const typed = createPiEditTool({
  signature: camelCaseEditSignature(),
  state: (call) => stores.get(call.host.sessionManager.getSessionId()) ?? null,
});
createPiWriteTool({
  // @ts-expect-error ExtensionContext has no session field
  state: (call) => stores.get(call.host.session) ?? null,
});

// Pi-typed and host-free extensions compose.
declare const hostGuard: Guard<ExtensionContext>;
declare const hostHook: WriteHook<ExtensionContext>;
export const composed = createPiApplyPatchTool({
  signature: defaultPatchSignature(),
  authorize: writeAuthorizers(
    protectPaths(),
    askBeforeWrite((plan, ctx) => ctx.call.host.ui.confirm("Write", `${plan.length} files`)),
  ),
  guards: [hostGuard],
  hooks: [hostHook],
});
export const unknownState = createPiWriteTool({
  state: (_call: ToolCallContext<unknown>) => null,
});

// @ts-expect-error fs is not an option: the root is ctx.cwd
createPiEditTool({ fs: null });
// @ts-expect-error cwd is not an option either
createPiFsTools({ cwd: "/" });
// @ts-expect-error the shared store is set once, at the top level
createPiFsTools({ edit: { state: null } });

// The state and digest pairing is in the options types (StateNeedsDigestOrDefault).
declare const store: ReadStateStore;
export const pairedEdit = createPiEditTool({ state: store });
// @ts-expect-error: a state needs a digest that is not null.
createPiEditTool({ state: store, digest: null });
export const bareEdit = createPiEditTool({ digest: null });
