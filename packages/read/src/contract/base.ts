import type { ListOutcome, PathOps } from "@better-fs-tools/fs";

import type { Clock, Digest } from "./digest.ts";
import type { JsonObject } from "./json.ts";

/*
 * Tool-neutral types. The read tool and the write tools share them, so a
 * resolver or authorizer written against these works for every tool.
 */

/**
 * Built by the adapter for each tool call. Every tool passes it by reference
 * to every stage and never reads `host`.
 */
export interface ToolCallContext<THost = undefined> {
  readonly signal?: AbortSignal;
  /** The framework's tool call id, when it has one. */
  readonly callId?: string;
  readonly host: THost;
}

/** "read", "edit", "write", "apply_patch", "bash", or a host tool. */
export type ToolName = "read" | "edit" | "write" | "apply_patch" | "bash" | (string & {});

/** A note any tool can emit. */
export interface Note {
  /** Stable identifier. */
  readonly code: string;
  readonly severity: "info" | "warning";
  readonly message: string;
  readonly data?: JsonObject;
}

/** Wording that shared helpers use. Every tool's catalog extends it. */
export interface ToolMessages {
  pathRepaired(c: { from: string; to: string }): string;
  denied(c: { path: string; detail: string | null }): string;
}

/** Given to every tool-neutral host function. */
export interface ToolHookContext<THost = undefined> {
  readonly tool: ToolName;
  readonly messages: Readonly<ToolMessages>;
  readonly digest: Digest | null;
  readonly clock: Clock;
  /** The same object for every stage of one call. */
  readonly call: ToolCallContext<THost>;
}

export interface ToolResolveContext<THost = undefined> extends ToolHookContext<THost> {
  readonly paths: PathOps;
  /** authorize("list") and one bounded fs.list. A second call in the same stage gets an error outcome. */
  list(dir: string): Promise<ListOutcome>;
}

export interface PathResolver<THost = undefined> {
  readonly id: string;
  resolve(path: string, ctx: ToolResolveContext<THost>): ResolveOutcome | Promise<ResolveOutcome>;
}

export type ResolveOutcome =
  | { readonly kind: "path"; readonly path: string; readonly note?: Note }
  | { readonly kind: "not-found"; readonly note?: Note };

/** The fields every authorize target has. */
export interface AccessTarget {
  readonly action: string;
  readonly requestedPath: string;
  readonly resolvedPath: string;
  readonly displayPath: string;
}

export type AccessDecision =
  | { readonly allow: true; readonly notes?: readonly Note[] }
  | { readonly allow: false; readonly note?: Note };

/** An authorizer that works for every tool. It sees only the fields every target has. */
export interface ToolAuthorizer<THost = undefined> {
  readonly id: string;
  authorize(
    target: AccessTarget,
    ctx: ToolHookContext<THost>,
  ): AccessDecision | Promise<AccessDecision>;
}
