/**
 * Type tests for the tool-neutral base types (W2). `tsc -b` checks this file;
 * Bun never runs it. A tool-neutral helper must fit the read tool, and read
 * types must extend the base types.
 */
import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, defaultMessages, denyPaths, expandHome } from "../../src/index.ts";
import type {
  AccessDecision,
  AuthorizeDecision,
  Authorizer,
  HookContext,
  MessageCatalog,
  Note,
  PathResolver,
  ReadContext,
  ReadNote,
  ResolveContext,
  ToolAuthorizer,
  ToolCallContext,
  ToolHookContext,
  ToolMessages,
  ToolName,
  ToolResolveContext,
} from "../../src/index.ts";

interface Host {
  readonly id: string;
}

const fs = memoryFileSystem();

// denyPaths is a ToolAuthorizer and fits the read Authorizer with any host.
export const neutral: ToolAuthorizer<unknown> = denyPaths(["**/.env"]);
export const asReadAuthorizer: Authorizer<{ id: string }> = denyPaths(["**/.env"]);
export const denyingTool = createReadTool<Host>({ fs, authorize: denyPaths(["**/.env"]) });

// A custom ToolAuthorizer fits read's authorize.
const custom: ToolAuthorizer<unknown> = {
  id: "no-lock",
  authorize: (target, ctx) =>
    target.resolvedPath.endsWith(".lock")
      ? {
          allow: false,
          note: {
            code: "denied",
            severity: "warning",
            message: ctx.messages.denied({ path: target.requestedPath, detail: null }),
          },
        }
      : { allow: true },
};
export const customTool = createReadTool<Host>({ fs, authorize: custom });

// A resolver typed on ToolResolveContext fits read `resolve`.
const neutralResolver: PathResolver<unknown> = {
  id: "neutral",
  resolve: (path: string, ctx: ToolResolveContext<unknown>) => ({
    kind: "path",
    path: ctx.paths.join("/w", path),
  }),
};
export const resolverTool = createReadTool<Host>({ fs, resolve: neutralResolver });
export const builtIn: PathResolver<Host> = expandHome({ home: "/home/me" });

// Read types extend the base types.
declare const readCall: ReadContext<Host>;
export const call: ToolCallContext<Host> = readCall;
declare const hookCtx: HookContext<Host>;
export const neutralHook: ToolHookContext<Host> = hookCtx;
export const readTool: "read" = hookCtx.tool;
declare const resolveCtx: ResolveContext<Host>;
export const neutralResolve: ToolResolveContext<Host> = resolveCtx;
export const catalog: ToolMessages = defaultMessages satisfies MessageCatalog;
declare const readNote: ReadNote;
export const note: Note = readNote;
declare const access: AccessDecision;
export const decision: AuthorizeDecision = access;

// ToolName takes the four tools and any host tool name.
export const names: readonly ToolName[] = ["read", "edit", "write", "apply_patch", "grep"];
