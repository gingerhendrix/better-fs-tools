/**
 * The Oh My Pi edit benchmark system prompt (`benchmark-system.md`), rendered
 * for a single-file task. Only the instruction line changes, so it names the
 * arm's edit tool.
 */
export function systemPrompt(editTool: string): string {
  return `Code-edit benchmark in repository: a single edit task.

Exactness-scored: get the edit right.

## Constraints
- Make exactly the task-specified change. Nothing more. Do not refactor, improve, or clean up other code.
- Tasks: single-token fixes to multi-hunk block rewrites. Shown replacement code: reproduce byte-for-byte; indentation, tabs vs. spaces, blank lines included.
- Similar regions: change only task-identified region(s).
- Verification: exact-text diff against expected fixture. Equivalent code, reordered imports/object keys, or formatting changes fail.
- NEVER modify comments or license headers unless explicitly requested.
- Re-read changed region; confirm exact task match.

## Process
- First user message: task definition.

Read the relevant files first, then use the ${editTool} tool to apply the fix. Paths are relative to the working directory. When the change is done, reply with a short confirmation and no tool call.`;
}
