---
packages:
  "@better-fs-tools/write": patch
---

## A loose match keeps the file's bytes on lines the model did not change

After a loose match, `edit` and `apply_patch` now keep more of the file as it was:

- A line that the model sends back unchanged keeps the file's own characters. In `edit`, these are the leading and trailing lines where the old text and the new text agree. In `apply_patch`, these are the `-` lines that come back as the same `+` lines. Context lines already kept their bytes.
- A replaced line keeps the CR of the file line it replaces. A CRLF line in a mixed-EOL file stays CRLF.
- When the old text and the new text of a hit are the same, the model wants only the folded characters changed, so the new text is written as given.

Before, a loose match wrote the model's text for every changed line. A file with one CRLF line lost its CR, and a guard line that the model retyped with plain spaces lost its special spaces. `lineTrimmedMatcher()` in `edit` follows the same rule. Files with only LF or only CRLF line endings keep their line endings as before.
