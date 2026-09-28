export interface EditPair {
  readonly oldText: string;
  readonly newText: string;
  /** Default false. */
  readonly replaceAll?: boolean;
}

/** Canonical core input. Model-facing names live in signatures. */
export interface EditInput {
  readonly path: string;
  /** One to limits.maxEdits pairs. Matched against one snapshot of the file. */
  readonly edits: readonly EditPair[];
}

export interface WriteInput {
  readonly path: string;
  readonly content: string;
}

export interface ApplyPatchInput {
  /** Codex patch text. */
  readonly patch: string;
}

export interface EditRequest {
  readonly tool: "edit";
  readonly path: string;
  readonly edits: readonly Required<EditPair>[];
}

export interface WriteRequest {
  readonly tool: "write";
  readonly path: string;
  readonly content: string;
}

export interface ApplyPatchRequest {
  readonly tool: "apply_patch";
  readonly patch: string;
}

export type MutationRequest = EditRequest | WriteRequest | ApplyPatchRequest;
