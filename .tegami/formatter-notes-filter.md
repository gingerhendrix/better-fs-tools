---
packages:
  "@better-fs-tools/write": minor
  "@better-fs-tools/shell": minor
---

## Hide or rewrite notes in the write and bash formatters

`defaultWriteFormatter()` and `defaultShellFormatter()` take a `notes` option, as the read tool's formatters do. The function gets a note and returns the note to show, a changed note, or `null` to hide it from the model text. The write version also gets the tool name. The report keeps every note, so a host can still log a note that it hides from the model.

```ts
defaultShellFormatter({ notes: (note) => (note.code === "spill-failed" ? null : note) });
```
