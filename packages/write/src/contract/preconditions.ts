export interface PreconditionPolicy {
  /** "existing": an existing file needs a record. "off": no read-before-write. Default "existing". */
  readonly requireRead: "existing" | "off";
  /** Which tools accept a record with wholeFileVisible false. "edit-only" means edit and apply_patch. Default "edit-only". */
  readonly partialRead: "edit-only" | "always" | "never";
  /** edit and apply_patch on a stale record. write always rejects. Default "rematch". */
  readonly onStale: "rematch" | "reject";
}

export const defaultPreconditions: Readonly<PreconditionPolicy> = Object.freeze({
  requireRead: "existing",
  partialRead: "edit-only",
  onStale: "rematch",
});
