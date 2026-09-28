import type { WritableFileSystem } from "@better-fs-tools/fs";
import type {
  AccessTarget,
  Classifier,
  Note,
  ToolCallContext,
  ToolHookContext,
} from "@better-fs-tools/read";

import type { TextStyle } from "./codec.ts";
import type { WriteToolName } from "./context.ts";
import type { MutationRequest } from "./input.ts";
import type { WriteLimits } from "./limits.ts";
import type { WriteMessageCatalog } from "./messages.ts";
import type { FileChange } from "./result.ts";

/** Given to every write host function. One object for each call. */
export interface WriteHookContext<THost = undefined> extends ToolHookContext<THost> {
  readonly tool: WriteToolName;
  readonly request: MutationRequest;
  readonly limits: Readonly<WriteLimits>;
  readonly messages: Readonly<WriteMessageCatalog>;
  readonly call: ToolCallContext<THost>;
}

/* Planned change: what guards, authorizers, and the formatter see before commit. */

export interface PlannedChange {
  readonly tool: WriteToolName;
  readonly kind: "create" | "update" | "delete" | "move";
  readonly requestedPath: string;
  readonly resolvedPath: string;
  readonly displayPath: string;
  /** Resolved path of the move source. null unless kind is "move". */
  readonly movedFrom: string | null;
  /** Decoded text before, in the codec's text space. null for create. */
  readonly before: PlannedText | null;
  /** Decoded text after. null for delete. */
  readonly after: PlannedText | null;
  /** Edit pairs; patch hunks as removed and added text; for write, one fragment with the whole content. */
  readonly fragments: readonly ChangeFragment[];
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly diff: string;
}

export interface PlannedText {
  readonly text: string;
  readonly style: TextStyle;
  /** Only for before. null without a digest. */
  readonly contentId: string | null;
  readonly version: string | null;
}

export interface ChangeFragment {
  readonly oldText: string;
  readonly newText: string;
}

/* Authorize */

export interface WriteAuthorizeTarget extends AccessTarget {
  readonly action: "create" | "update" | "delete" | "move";
  readonly tool: WriteToolName;
  /** null in the access stage, before any content byte is read. */
  readonly change: PlannedChange | null;
  /** Every change in this call, in order. Empty in the access stage. */
  readonly plan: readonly PlannedChange[];
}

/** W6: content replaces the planned text. Only for edit and write, and only in the change stage. */
export type WriteAuthorizeDecision =
  | { readonly allow: true; readonly notes?: readonly Note[]; readonly content?: string }
  | { readonly allow: false; readonly note?: Note };

/** Runs twice: once for each target before any content byte is read, then once for each planned change. */
export interface WriteAuthorizer<THost = undefined> {
  readonly id: string;
  authorize(
    target: WriteAuthorizeTarget,
    ctx: WriteHookContext<THost>,
  ): WriteAuthorizeDecision | Promise<WriteAuthorizeDecision>;
}

/* Guards */

export interface GuardContext<THost = undefined> extends WriteHookContext<THost> {
  readonly classifiers: readonly Classifier[];
}

export type GuardDecision =
  | { readonly allow: true; readonly notes?: readonly Note[] }
  | { readonly allow: false; readonly note: Note };

export interface Guard<THost = undefined> {
  readonly id: string;
  /** Runs on each planned change before the change-stage authorize. */
  check(change: PlannedChange, ctx: GuardContext<THost>): GuardDecision | Promise<GuardDecision>;
}

/* After-write hooks */

export interface AfterWriteContext<THost = undefined> extends WriteHookContext<THost> {
  /** The call's filesystem. Host code may read or rewrite the file through it. */
  readonly fs: WritableFileSystem;
}

export interface WriteHookResult {
  readonly notes?: readonly Note[];
  /** true when the hook changed the file. The core re-reads and re-hashes it before record. */
  readonly rewrote?: boolean;
}

export interface WriteHook<THost = undefined> {
  readonly id: string;
  afterWrite(
    change: FileChange,
    ctx: AfterWriteContext<THost>,
  ): WriteHookResult | Promise<WriteHookResult>;
}
