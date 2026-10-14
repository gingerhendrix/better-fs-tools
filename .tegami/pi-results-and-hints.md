---
packages:
  "@better-fs-tools/pi": minor
---

## Pi tool errors set isError, and read and bash give structured output

The Pi tools now set the Pi 1.x result fields:

- Every tool returns `isError: true` for a tool error. Before, Pi recorded a failed call as a success. `bash` also sets it for a nonzero exit and a timeout, as Pi's own `bash` does.
- `read` and `bash` declare the `outputSchema` of Pi's own `read` and `bash`, and return a matching `structuredContent`. A codemode script that calls them gets the same value as from Pi's own tools. `edit`, `write`, and `apply_patch` declare no schema, as Pi's own `edit` and `write`.
- Each file tool sets `annotations`: `readOnlyHint: true` on `read`, and `destructiveHint: true` on `edit`, `write`, and `apply_patch`. Permission extensions can read them.

`PiReadToolResult`, `PiMutationToolResult`, and `PiBashToolResult` have a new required `isError` field. Code that builds these results by hand must set it.
