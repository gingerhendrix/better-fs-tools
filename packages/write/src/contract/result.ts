import type { ContentPart, Note, ToolError } from "@better-fs-tools/read";

import type { WriteToolName } from "./context.ts";

/**
 * One variant for each status. `status` narrows the union: only the "error"
 * variant has `error`, and it is never null there.
 */
export type MutationReport = MutationOk | MutationNoChange | MutationFailure;

interface MutationFields {
  readonly tool: WriteToolName;
  /** Committed changes. Empty unless status is "ok", except a failed commit that left files changed. */
  readonly changes: readonly FileChange[];
  /** Display paths of the files a "no-change" result left as they were. Empty otherwise. */
  readonly unchanged: readonly string[];
  readonly notes: readonly Note[];
}

export interface MutationOk extends MutationFields {
  readonly status: "ok";
  readonly commit: null;
}

/** Nothing to write (already applied, or the same content). Not an error. */
export interface MutationNoChange extends MutationFields {
  readonly status: "no-change";
  readonly commit: null;
}

export interface MutationFailure extends MutationFields {
  readonly status: "error";
  readonly error: WriteError;
  /** Set when an apply_patch commit failed after its first publish step. */
  readonly commit: CommitReport | null;
}

/** The report plus the formatter's model-facing content. */
export type MutationResult = MutationReport & { readonly content: readonly ContentPart[] };

/** The error of a failed call. Same shape as the read and shell errors. */
export type WriteError = ToolError<WriteErrorCode, WritePhase>;

export type WritePhase =
  | "input"
  | "resolve"
  | "stat"
  | "lock"
  | "load"
  | "precondition"
  | "plan"
  | "guards"
  | "authorize"
  | "encode"
  | "commit"
  | "hooks"
  | "record";

/** UPPER_SNAKE, like every tool's error codes. The error note's code is the kebab-case form. */
export type WriteErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_A_FILE"
  | "DANGEROUS_PATH"
  | "OUTSIDE_ALLOWED_ROOTS"
  | "PERMISSION_DENIED"
  | "DENIED"
  | "READ_ONLY"
  | "NO_SPACE"
  | "UNSUPPORTED_BACKEND"
  | "ABORTED"
  | "IO_ERROR"
  | "EXTENSION_FAILED"
  | "LOCK_TIMEOUT"
  | "NOT_READ"
  | "STALE"
  | "EXISTS"
  | "TOO_LARGE"
  | "NOT_TEXT"
  | "NO_MATCH"
  | "AMBIGUOUS_MATCH"
  | "MATCH_REFUSED"
  | "OVERLAP"
  | "NO_CHANGE"
  | "GUARD_REFUSED"
  | "PATCH_PARSE"
  | "PATCH_VERIFY"
  | "PARTIAL_COMMIT";

export interface FileChange {
  readonly kind: "create" | "update" | "delete" | "move";
  /** Display path. For a move, the destination. */
  readonly path: string;
  readonly requestedPath: string;
  readonly resolvedPath: string;
  /** Display path of the move source. null unless kind is "move". */
  readonly movedFrom: string | null;
  readonly before: FileVersion | null;
  readonly after: FileVersion | null;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  /** Unified diff with a/ and b/ headers, cut at limits.maxDiffLines. */
  readonly diff: string;
  readonly diffTruncated: boolean;
  /** One entry for each edit pair or patch hunk that matched. Empty for write. An already applied pair has none. */
  readonly matches: readonly MatchInfo[];
  /** Result lines around each change, for the model text. Empty for write and delete. */
  readonly snippets: readonly Snippet[];
  /** An authorizer replaced the planned content. */
  readonly userModified: boolean;
  /** Resolved paths, outermost first. */
  readonly createdDirectories: readonly string[];
}

export interface FileVersion {
  /** null without a digest. */
  readonly contentId: string | null;
  /** null when the backend gave none. */
  readonly version: string | null;
  readonly bytes: number;
}

export interface MatchInfo {
  /** Zero-based edit pair or hunk index. */
  readonly index: number;
  readonly matcher: string;
  readonly fuzzy: boolean;
  /** One-based inclusive lines in the file before the change. The first match when count > 1. */
  readonly lines: readonly [number, number];
  /** Replacements made. More than 1 only with replaceAll. */
  readonly count: number;
  /**
   * One-based inclusive lines of each replacement in the file after the
   * change, in order. At most limits.maxListedMatches entries.
   */
  readonly replaced: readonly (readonly [number, number])[];
}

export interface Snippet {
  /** One-based line of lines[0] in the file after the change. */
  readonly startLine: number;
  readonly lines: readonly string[];
}

export interface CommitReport {
  /** true when every published step was undone. */
  readonly rolledBack: boolean;
  /** Every file the patch targets, in patch order. */
  readonly files: readonly CommitFileState[];
}

export interface CommitFileState {
  readonly path: string;
  readonly state: "unchanged" | "committed" | "restored" | "rollback-failed";
  readonly code?: WriteErrorCode;
}
