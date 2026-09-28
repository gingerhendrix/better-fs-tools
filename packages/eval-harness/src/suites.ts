/**
 * Named task lists over the Oh My Pi fixtures. `poc-12` is a hand-picked
 * spread for the proof of concept: 4 easy, 4 medium, 3 hard, 1 nightmare.
 * It covers single-token, duplicate-line, multi-edit, and structural tasks.
 * It is not calibrated. Calibrate and freeze a larger list before real runs.
 */
export const SUITES: Readonly<Record<string, readonly string[]>> = {
  "poc-12": [
    "call-swap-call-args-001",
    "unicode-unicode-hyphen-001",
    "duplicate-duplicate-line-flip-005",
    "identifier-identifier-multi-edit-001",
    "multi-composite-multi-edit-002",
    "structural-move-distant-block-003",
    "structural-swap-if-else-006",
    "structural-wrap-redundant-if-011",
    "identifier-identifier-multi-edit-003",
    "structural-remove-case-label-007",
    "duplicate-duplicate-line-flip-003",
    "multi-composite-multi-edit-008",
  ],
  smoke: ["call-swap-call-args-001", "structural-move-distant-block-003"],
};
