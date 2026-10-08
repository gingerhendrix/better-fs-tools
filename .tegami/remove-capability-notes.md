---
packages:
  "@better-fs-tools/read": minor
---

## Remove the capability notes from read results

`read` no longer adds the `weak-identity` and `buffered-backend` info notes. The model cannot act on either note, so they used tokens and gave no value. The `streaming` and `identity` capabilities stay. `identity: false` still sets `file.identity` to `null`, and the write tools still judge freshness by the content hash. The `weakIdentity` and `bufferedBackend` entries are gone from `ReadMessageCatalog`.
