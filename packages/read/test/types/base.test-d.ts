// Type tests: `tsc -b` checks this file; Bun never runs it.
import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, defaultReadMessages, denyPaths, expandHome } from "../../src/index.ts";
import type {
  AccessDecision,
  Note,
  PathResolver,
  ReadAuthorizeDecision,
  ReadAuthorizer,
  ReadContext,
  ReadHookContext,
  ReadMessageCatalog,
  ReadNote,
  ReadResolveContext,
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

// denyPaths is a ToolAuthorizer and fits a ReadAuthorizer with any host.
export const neutral: ToolAuthorizer<unknown> = denyPaths(["**/.env"]);
export const asReadAuthorizer: ReadAuthorizer<{ id: string }> = denyPaths(["**/.env"]);
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
declare const hookCtx: ReadHookContext<Host>;
export const neutralHook: ToolHookContext<Host> = hookCtx;
export const readTool: "read" = hookCtx.tool;
declare const resolveCtx: ReadResolveContext<Host>;
export const neutralResolve: ToolResolveContext<Host> = resolveCtx;
export const catalog: ToolMessages = defaultReadMessages satisfies ReadMessageCatalog;
declare const readNote: ReadNote;
export const note: Note = readNote;
declare const access: AccessDecision;
export const decision: ReadAuthorizeDecision = access;

// ToolName takes the five tools and any host tool name.
export const names: readonly ToolName[] = ["read", "edit", "write", "apply_patch", "bash", "grep"];
