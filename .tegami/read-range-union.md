---
packages:
  "@better-fs-tools/read": minor
  "@better-fs-tools/write": patch
---

## Reads in ranges count as a read of the whole file

`write` refuses to replace a file that the model has not read in full. Before, only one read that showed the whole file counted. A model that read lines 1 to 30 and then lines 28 to 47 of a 35-line file got `NOT_READ`.

Now the read tool joins the line ranges of each read of the same content. When the ranges run from line 1 to the last line, the stored record has `wholeFileVisible: true`, and `write` goes ahead. A change to the file starts the ranges again. A line that the view clamped does not count. A ranged read after a whole read of the same content keeps the record whole.

`ReadObservation` has a new `visibleLines` field, and `ReadRecord` has a new `seenLines` field. A store that builds its own records must add `seenLines`. A stored record without it counts as no range. The `NOT_READ` text for `write` now says that reads in ranges count.
