/** Turns patch text into a plan. The default is codexPatchParser(). A host may add another format. */
export interface PatchParser {
  readonly id: string;
  /** Sync and pure. Must not throw for any string input. */
  parse(text: string): PatchParseOutcome;
}

export type PatchParseOutcome =
  | { readonly ok: true; readonly plan: PatchPlan }
  | { readonly ok: false; readonly error: { readonly line: number; readonly detail: string } };

export interface PatchPlan {
  readonly operations: readonly PatchOperation[];
}

export type PatchOperation =
  | {
      readonly kind: "add";
      readonly path: string;
      readonly content: string;
      readonly line: number;
    }
  | { readonly kind: "delete"; readonly path: string; readonly line: number }
  | {
      readonly kind: "update";
      readonly path: string;
      readonly moveTo: string | null;
      readonly hunks: readonly PatchHunk[];
      readonly line: number;
    };

export interface PatchHunk {
  /** Text after "@@ ". null for a bare "@@" or a first hunk with no "@@". */
  readonly context: string | null;
  /** The hunk body in order. Old lines are the " " and "-" lines. New lines are the " " and "+" lines. */
  readonly lines: readonly PatchLine[];
  /** "*** End of File" closed the hunk. */
  readonly endOfFile: boolean;
  /** One-based line of the hunk in the patch text. */
  readonly line: number;
}

export interface PatchLine {
  readonly kind: " " | "-" | "+";
  /** The line without its prefix and without a line break. */
  readonly text: string;
}
