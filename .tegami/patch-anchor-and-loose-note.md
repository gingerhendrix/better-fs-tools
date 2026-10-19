---
packages:
  "@better-fs-tools/write": patch
---

## `apply_patch` accepts a hunk whose `@@` line is the line it changes

A model often writes the line it changes as the `@@` header:

```text
@@ target: A−B
-target: A−B
+target: A-B
```

Codex looks for the old lines only below the `@@` line, so this hunk always failed. Now, when the old lines are not found below the `@@` line, `apply_patch` also tries them at the `@@` line itself, and takes that hit only when it starts there. A hunk whose first context line repeats the header works the same way. Hunks that matched before match at the same place.

A hunk that still does not match now says where the search started, for example `failed to find the expected lines at line 2, where the @@ line matched, or from line 3 on`. `patchLinesNotFound` gets two optional arguments, `from` and `context`, so host messages keep working.
