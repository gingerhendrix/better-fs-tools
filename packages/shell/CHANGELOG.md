## @better-fs-tools/shell@0.2.0

### Hide or rewrite notes in the write and bash formatters

`defaultWriteFormatter()` and `defaultShellFormatter()` take a `notes` option, as the read tool's formatters do. The function gets a note and returns the note to show, a changed note, or `null` to hide it from the model text. The write version also gets the tool name. The report keeps every note, so a host can still log a note that it hides from the model.

```ts
defaultShellFormatter({ notes: (note) => (note.code === "clamped" ? null : note) });
```

### Remove notes that only the host can act on

The tools no longer add notes that the model cannot act on:

- `extension-failed` from a failed formatter, in read, `edit`, `write`, `apply_patch`, and bash. The default formatter still formats the result, and the status stays. The `extension-failed` error note of an `EXTENSION_FAILED` error stays.
- `directories-created` in the write tools. `FileChange.createdDirectories` still lists the new folders.
- `hook-failed` in the write tools. A hook that throws after the commit still does not fail the call.
- `spill-failed` in bash. The command is still not affected, and `output.spill` is `null`.

The `formatterFailed` entry is gone from `ReadMessageCatalog` and `WriteMessageCatalog`. The `directoriesCreated` and `hookFailed` entries are gone from `WriteMessageCatalog`, and `spillFailed` is gone from `ShellMessageCatalog`.

## @better-fs-tools/shell@0.1.0

### First npm release

The first public release of the Better FS Tools packages. Each package ships compiled ES modules and TypeScript declarations from `dist/`.
