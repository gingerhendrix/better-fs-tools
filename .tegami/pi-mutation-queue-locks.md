---
packages:
  "@better-fs-tools/pi": minor
---

## The Pi write tools share Pi's per-file queue

`piMutationQueueLocks()` is a lock manager on Pi's own `withFileMutationQueue()`. It is now the default `locks` of `createPiFsTools()`, `createPiEditTool()`, `createPiWriteTool()`, and `createPiApplyPatchTool()`. A Better FS Tools `edit` and Pi's own `edit` or `write` on the same file now wait for each other. Before, the Pi tools used `memoryLocks()`, which Pi's own tools do not see.

Pass `locks: memoryLocks()` for the old behaviour. `piMutationQueueLocks({ timeoutMs })` waits 30 seconds by default.
