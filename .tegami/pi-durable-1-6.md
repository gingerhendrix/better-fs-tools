---
packages:
  "@better-fs-tools/pi-durable": minor
---

## pi-durable needs pi 1.6

**Peer ranges.** `@earendil-works/pi-durable` and `@earendil-works/chord` are now `~1.6.0`. pi 1.2, 1.3, 1.4, and 1.5 are not supported. To keep pi 1.2, stay on `@better-fs-tools/pi-durable` 0.3.

**Read records update again.** On pi 1.4 and later, `documentReadStore()` stored the first read record of a path, and each later change of that record failed. The tools hid the error, so the record stayed stale, and an `edit` after an earlier `edit` of the same file was refused. `ReadStateDoc` now sets the `checkpointWhen` predicate that pi 1.4 made required, so a put or a delete replaces the record. Each change is stored as a complete record.
