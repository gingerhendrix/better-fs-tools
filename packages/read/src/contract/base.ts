import type { ListOutcome, PathOps } from "@better-fs-tools/fs";

import type { Clock, Digest } from "./digest.ts";
import type { JsonObject } from "./json.ts";

/** Per-call context. Tools pass `host` through to extensions and never read it. */
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
  /** Stable identifier, in kebab case, for example "denied" or "clamped". */
  readonly code: string;
  readonly severity: "info" | "warning";
  readonly message: string;
  readonly data?: JsonObject;
}

/**
 * The error of a result with status "error", in every tool. `code` is
 * UPPER_SNAKE. The result's error note has the same code in kebab case, and
 * `message` and `data` are copied from that note.
 */
export interface ToolError<TCode extends string = string, TPhase extends string = string> {
  readonly code: TCode;
  /** The stage that failed. */
  readonly phase: TPhase;
  /** The error note's message. */
  readonly message: string;
  /** The error note's data, when it has any. */
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
  /** Authorizes and lists a directory. A second call in the same stage returns an error outcome. */
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
  // A function property, not a method, so TypeScript checks the target type strictly.
  readonly authorize: (
    target: AccessTarget,
    ctx: ToolHookContext<THost>,
  ) => AccessDecision | Promise<AccessDecision>;
}

/**
 * The model-facing side of a tool: its name, description, JSON Schema, and the
 * map from model input to the tool's canonical input. `TParam` is the tool's
 * canonical parameter names.
 */
export interface ToolSignature<TInput, TParam extends string = string> {
  /** The tool name the model sees. */
  readonly name: string;
  readonly description: string;
  /** Plain JSON Schema with a description on each parameter. */
  readonly schema: JsonObject;
  /** Validates model input and maps it to canonical input. Throws TypeError that names host parameters. */
  toInput(input: unknown): TInput;
  /**
   * Host name for a canonical parameter, for messages. An empty string means
   * the signature has no such parameter, and messages leave out the advice
   * that names it.
   */
  param(name: TParam): string;
  /** Set on freeform signatures. Hosts that support grammar tools use it. */
  readonly grammar?: { readonly lark: string };
}

/**
 * The options every signature preset takes. `TParam` is the preset's own
 * parameter names. `names` gives a parameter another name in the schema, and
 * `describe` replaces its description. Both are keyed by the preset's names.
 */
export interface SignatureDocs<TParam extends string> {
  /** The tool name. */
  readonly name?: string;
  readonly description?: string;
  readonly describe?: Partial<Record<TParam, string>>;
  readonly names?: Partial<Record<TParam, string>>;
}
