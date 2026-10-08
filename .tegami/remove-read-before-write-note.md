---
packages:
  "@better-fs-tools/write": minor
---

## Remove the read-before-write-off note

With no state store, `edit`, `write`, and `apply_patch` no longer add the `read-before-write-off` warning note. The host chooses whether to give a store, and the model cannot change that choice, so the note used tokens and gave no value. The tools behave as before: with no store, they change a file without a read check. The `readBeforeWriteOff` entry is gone from `WriteMessageCatalog`.
