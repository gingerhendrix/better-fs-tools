// Type tests: `tsc -b` checks this file; Bun never runs it.
import { memoryFileSystem } from "@better-fs-tools/fs";

import {
  askUser,
  createReadTool,
  defaultSuggest,
  denyPaths,
  expandHome,
  pathResolvers,
  readAuthorizers,
  reanchorLeadingSlash,
  sizeCeiling,
  stripPrefixes,
  unicodeRepair,
} from "../../src/index.ts";
import type {
  PathResolver,
  ReadAuthorizeDecision,
  ReadAuthorizer,
  ReadAuthorizeTarget,
  ReadDependencies,
  ReadHookContext,
  ReadResolveContext,
  Suggest,
  SuggestContext,
} from "../../src/index.ts";

interface Host {
  readonly id: string;
}

const fs = memoryFileSystem();

// Host-free resolvers and suggest fit a tool with a typed host.
export const hostFree = createReadTool<Host>({
  fs,
  resolve: unicodeRepair(),
  suggest: defaultSuggest(),
});
export const unknownResolver: PathResolver<Host> = expandHome({ home: "/home/me" });
export const unknownSuggest: Suggest<Host> = defaultSuggest();
export const plainTool = createReadTool({ fs, resolve: stripPrefixes(), suggest: null });

// A host-typed resolver reads ctx.call.host with its type.
const sessionResolver: PathResolver<Host> = {
  id: "session",
  resolve(path, ctx) {
    const id: string = ctx.call.host.id;
    return { kind: "path", path: `${id}/${path}` };
  },
};

// Host-free and host-typed steps compose, and the chain fits the typed tool.
export const chained = createReadTool<Host>({
  fs,
  resolve: pathResolvers(
    stripPrefixes(),
    expandHome({ home: "/home/me" }),
    reanchorLeadingSlash({ firstSegmentExists: () => false }),
    sessionResolver,
    unicodeRepair({ note: false }),
  ),
});
export const hostFreeChain: PathResolver<Host> = pathResolvers(stripPrefixes(), unicodeRepair());

// An inline step takes its host type from the tool, with no type argument.
export const inlineStep = createReadTool<Host>({
  fs,
  resolve: pathResolvers(stripPrefixes(), {
    id: "inline",
    resolve: (path, ctx) => ({ kind: "path", path: `${ctx.call.host.id}/${path}` }),
  }),
});

createReadTool<{ user: number }>({
  fs,
  // @ts-expect-error a Host step does not fit a chain for another host
  resolve: pathResolvers(stripPrefixes(), sessionResolver),
});

createReadTool<Host>({
  fs,
  resolve: pathResolvers({
    id: "inline",
    // @ts-expect-error the host has no session field
    resolve: (path, ctx) => ({ kind: "path", path: `${ctx.call.host.session}/${path}` }),
  }),
});

// A host-typed suggest reads the host too.
export const hostSuggest: ReadDependencies<Host>["suggest"] = (ctx) => [ctx.call.host.id];

// Context types widen to unknown and do not narrow back.
declare const hook: ReadHookContext<Host>;
declare const resolveCtx: ReadResolveContext<Host>;
declare const suggestCtx: SuggestContext<Host>;
export const widenedHook: ReadHookContext<unknown> = hook;
export const widenedResolve: ReadResolveContext<unknown> = resolveCtx;
export const widenedSuggest: SuggestContext<unknown> = suggestCtx;
declare const unknownHook: ReadHookContext<unknown>;
// @ts-expect-error an unknown host is not a Host
export const narrowedHook: ReadHookContext<Host> = unknownHook;

// A resolver for another host type does not fit.
declare const otherResolver: PathResolver<{ user: number }>;
// @ts-expect-error the host types differ
createReadTool<Host>({ fs, resolve: otherResolver });

createReadTool<Host>({
  fs,
  // @ts-expect-error the host has no session field
  suggest: (ctx) => [ctx.call.host.session],
});

// A resolver outcome has a closed kind.
export const badOutcome: PathResolver<unknown> = {
  id: "bad",
  // @ts-expect-error "moved" is not a resolve outcome kind
  resolve: (path) => ({ kind: "moved", path }),
};

// Host-free authorizers fit a tool with a typed host.
export const hostFreeAuthorize = createReadTool<Host>({ fs, authorize: denyPaths(["**/.env"]) });
export const unknownAuthorizer: ReadAuthorizer<Host> = sizeCeiling({ maxBytes: 1 });
export const plainAuthorize = createReadTool({ fs, authorize: sizeCeiling({ maxBytes: 1 }) });

// A host-typed authorizer reads ctx.call.host with its type.
const sessionAuthorizer: ReadAuthorizer<Host> = {
  id: "session",
  authorize(target, ctx) {
    const id: string = ctx.call.host.id;
    return { allow: target.requestedPath.startsWith(id) };
  },
};

// askUser takes its host type from the tool, with no type argument.
export const asked = createReadTool<Host>({
  fs,
  authorize: askUser(async (target, ctx) => ctx.call.host.id === target.displayPath),
});

// Mixed host-free and host-typed authorizers compose, and the chain fits the typed tool.
export const mixed = createReadTool<Host>({
  fs,
  authorize: readAuthorizers(
    denyPaths(["**/.env"]),
    sessionAuthorizer,
    sizeCeiling({ maxBytes: 1, unrangedOnly: true }),
    askUser(async (_target, ctx) => ctx.call.host.id !== ""),
  ),
});
export const hostFreeAuthorizers: ReadAuthorizer<Host> = readAuthorizers(
  denyPaths([]),
  sizeCeiling({ maxBytes: 1 }),
);

// An authorizer for another host type does not fit.
declare const otherAuthorizer: ReadAuthorizer<{ user: number }>;
// @ts-expect-error the host types differ
createReadTool<Host>({ fs, authorize: otherAuthorizer });

createReadTool<{ user: number }>({
  fs,
  // @ts-expect-error a Host step does not fit a chain for another host
  authorize: readAuthorizers(denyPaths([]), sessionAuthorizer),
});

createReadTool<Host>({
  fs,
  // @ts-expect-error the host has no session field
  authorize: askUser(async (_target, ctx) => ctx.call.host.session),
});

// The decision and the target are closed shapes.
export const allowWithNote: ReadAuthorizeDecision = {
  allow: true,
  // @ts-expect-error an allow carries notes, not one note
  note: { code: "x", severity: "info", message: "x" },
};
// @ts-expect-error allow is a boolean literal
export const maybe: ReadAuthorizeDecision = { allow: "yes" };
export const badTarget: ReadAuthorizeTarget = {
  // @ts-expect-error the action is "read" or "list"
  action: "write",
  requestedPath: "a",
  resolvedPath: "a",
  displayPath: "a",
  size: null,
  mtimeMs: null,
};
