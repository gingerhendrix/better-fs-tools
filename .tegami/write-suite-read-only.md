---
packages:
  "@better-fs-tools/fs": patch
---

## The write conformance suite accepts `read-only` for a refused path

`runWritableFileSystemConformance()` checks that a write to `refusedPath` gives a policy reason. That check now also accepts `read-only`, because a mutation error can carry it. Before, a backend that refused a write with `read-only`, for example on `EROFS`, failed the check. The read suite still accepts only the read policy reasons.
