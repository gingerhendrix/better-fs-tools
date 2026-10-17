---
packages:
  "@better-fs-tools/pi": minor
---

## piMutationQueueLocks() shares Pi's per-file queue

`piMutationQueueLocks()` is a lock manager on Pi's own `withFileMutationQueue()`. Pass it as `locks` to `createPiFsTools()` or a Pi write tool, so a Better FS Tools `edit` and Pi's own `edit` or `write` on the same file wait for each other. The `./extension` entry uses it. `piMutationQueueLocks({ timeoutMs })` waits 30 seconds by default.
