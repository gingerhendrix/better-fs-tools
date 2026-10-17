---
packages:
  "@better-fs-tools/pi": minor
---

## Pi tool errors set isError, and the tools carry annotations

The Pi tools now set the Pi 1.x result fields:

- Every tool returns `isError: true` for a tool error. Before, Pi recorded a failed call as a success. `bash` also sets it for a nonzero exit and a timeout, as Pi's own `bash` does.
- Each file tool sets `annotations`: `readOnlyHint: true` on `read`, and `destructiveHint: true` on `edit`, `write`, and `apply_patch`. Permission extensions can read them.
- No tool declares an `outputSchema` or returns `structuredContent`. A codemode script gets the text of the result, and a result with `isError: true` makes the call reject.

`PiReadToolResult`, `PiMutationToolResult`, and `PiBashToolResult` have a new required `isError` field. Code that builds these results by hand must set it.
