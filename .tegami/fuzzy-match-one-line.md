---
packages:
  "@better-fs-tools/write": patch
---

## A one-line fuzzy match names one line

The `fuzzy-match` note of `edit` and `apply_patch` now says `at line 4` when the match covers one line. Before, it said `at lines 4-4`. A match over more lines still says `at lines 4-6`.
