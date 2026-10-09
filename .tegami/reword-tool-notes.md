---
packages:
  "@better-fs-tools/read": patch
  "@better-fs-tools/write": patch
---

## Remove internal words from note and error text

Six default messages used words that only make sense inside the package. They now say what happened in plain words:

- read `scan-limit`: "Scanning stopped at N bytes, so the total line count is unknown."
- read `not-a-file`: "PATH is a directory." The list of refused types and "before any content read" are gone.
- read and write `dangerous-path`: "PATH is refused by policy (DETAIL). Choose another path." The phrase "refused policy class" is gone.
- read `unsupported-backend`: "This host cannot read PATH (DETAIL). Do not retry."
- read `aborted`: "The read was aborted during the PHASE phase, so nothing was read."

The write `unsupported-backend` detail for a file that no classifier accepts is now "its file type is not supported". Codes, data, and catalog keys do not change. A host that matches the old text must update its match.
