/**
 * Type tests for the resolve and suggest contract. `tsc -b` checks this file;
 * Bun never runs it. Deviation 1 of batch 1: a host-free helper typed with
 * unknown must fit a tool with a typed host.
 */
import { memoryFileSystem } from "@better-fs-tools/fs";

import {
  createReadTool,
  defaultSuggest,
  expandHome,
  pathResolvers,
  reanchorLeadingSlash,
  stripPrefixes,
  unicodeRepair,
} from "../../src/index.ts";
import type {
  Dependencies,
  HookContext,
  PathResolver,
  ResolveContext,
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

// A host-typed suggest reads the host too.
export const hostSuggest: Dependencies<Host>["suggest"] = (ctx) => [ctx.call.host.id];

// Context types widen to unknown and do not narrow back.
declare const hook: HookContext<Host>;
declare const resolveCtx: ResolveContext<Host>;
declare const suggestCtx: SuggestContext<Host>;
export const widenedHook: HookContext<unknown> = hook;
export const widenedResolve: ResolveContext<unknown> = resolveCtx;
export const widenedSuggest: SuggestContext<unknown> = suggestCtx;
declare const unknownHook: HookContext<unknown>;
// @ts-expect-error an unknown host is not a Host
export const narrowedHook: HookContext<Host> = unknownHook;

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
