## @better-fs-tools/write@0.2.0

### Hide or rewrite notes in the write and bash formatters

`defaultWriteFormatter()` and `defaultShellFormatter()` take a `notes` option, as the read tool's formatters do. The function gets a note and returns the note to show, a changed note, or `null` to hide it from the model text. The write version also gets the tool name. The report keeps every note, so a host can still log a note that it hides from the model.

```ts
defaultShellFormatter({ notes: (note) => (note.code === "clamped" ? null : note) });
```

### Minimal defaults for notebooks, hard links, and the read view

Three more defaults now follow the most common behaviour of other agent harnesses. Each old behaviour is one option away.

| Old default                                                                                                                    | New default                                                                                                                                   | Option that brings the old behaviour back                      |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `defaultClassifiers()` has `notebookClassifier()`, so read refuses a `.ipynb` file, and edit and write refuse it as `NOT_TEXT` | A notebook is JSON text. `defaultClassifiers()` is image, pdf, office, binary, utf8                                                           | `classifiers: [notebookClassifier(), ...defaultClassifiers()]` |
| `nodeFileSystem`, `createNodeFsTools()`, and the Pi tools refuse to replace a file with more than one hard link                | `hardLinks: "in-place"`: the file is written through the link, not atomically. A file with one link is still replaced by temp file and rename | `hardLinks: "refuse"`                                          |
| `maxViewBytes` is 128 KiB                                                                                                      | 50 KiB. `maxLines` and `maxCharsPerLine` stay at 2 000                                                                                        | `limits: { maxViewBytes: 128 * 1_024 }`                        |

`notebookClassifier()` and `notebookConverter()` are still exported. The converter accepts code `NOTEBOOK`, so it needs `notebookClassifier()` in the chain. The write tools use the same classifiers, so with the default list `nonTextGuard()` in `recommendedGuards()` no longer refuses a notebook. The same `classifiers` option turns that refusal back on.

### Minimal defaults for the write tools and the bundles

The defaults now follow the most common behaviour of other agent harnesses. Each removed behaviour is still one option away.

| Old default                                                                                        | New default                                            | Opt-in that brings the old behaviour back                                      |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| The bundles create `read`, `edit`, `write`, and `apply_patch`. The Pi extension registers all four | `read`, `edit`, and `write`. `applyPatch` is `null`    | `applyPatch: true`, or an options object as before                             |
| The bundles share a `memoryStore({ clock })`, so `edit` and `write` need a read first              | `state: null`: no read-before-write                    | `state: memoryStore({ clock })`                                                |
| A stale `edit` or `apply_patch` re-matches against the new content (`onStale: "rematch"`)          | `onStale: "reject"`: a plain `STALE`                   | `preconditions: { onStale: "rematch" }`                                        |
| Five guards run on every write                                                                     | `guards: []`. `defaultGuards()` returns an empty list  | `guards: recommendedGuards()`                                                  |
| `edit` matchers: `exact`, `normalized`, `escape`                                                   | `exact`, `normalized`                                  | `matchers: [...defaultEditMatchers(), escapeMatcher()]`                        |
| The `edit` model text shows the numbered lines around each change                                  | The first line only                                    | `formatter: defaultWriteFormatter({ snippet: true })`                          |
| A miss shows the closest region, a found new text is `already-applied`, the third miss adds a note | A plain `NO_MATCH`, even when the new text is in place | `recovery: true` in the `edit` options, for example `edit: { recovery: true }` |

In the bundles, these options go in the tool's own options, for example `edit: { recovery: true, guards: recommendedGuards() }`. The tool descriptions still ask the model to read a file before it edits it.

`createFsTools()`, `createNodeFsTools()`, `createAiSdkFsTools()`, and `createPiFsTools()` return `applyPatch: null` unless asked. The AI SDK `tools` record has no `apply_patch` key unless asked. New types `FsToolsWithApplyPatch`, `NodeFsToolsWithApplyPatch`, `AiSdkFsToolsWithApplyPatch`, and `PiFsToolsWithApplyPatch` give a non-null `applyPatch` when the option is set.

### Remove capability flags that only made notes

A capability flag now exists only when a tool reads it to decide what to do.

- `FileSystemCapabilities.streaming` is gone. The read core reads `bytes()` the same way for one chunk or many. `capabilities` is now `{ identity }`. The memory backend keeps its `streaming` option, because it sets how `bytes()` splits the file.
- `WriteCapabilities.atomic` and `WriteCapabilities.preserveMode` are gone. `writeCapabilities` is now `{ compareAndSwap }`. When `compareAndSwap` is false, the write tools still stat the target just before the write.
- `MutatedFile.atomic` is gone. Only the `not-atomic` note read it.
- The write tools no longer add the `not-atomic`, `no-compare-and-swap`, and `mode-not-kept` notes. The `notAtomic`, `noCompareAndSwap`, and `modeNotKept` entries are gone from the write message catalog.
- `runWritableFileSystemConformance` always runs "a replace keeps the mode". A backend whose `stat()` reports `mode: null` passes it.
- The `writeCapabilities` option of `memoryFileSystem` takes only `compareAndSwap`. The memory backend always keeps the mode of an existing file.

### Remove notes that only the host can act on

The tools no longer add notes that the model cannot act on:

- `extension-failed` from a failed formatter, in read, `edit`, `write`, `apply_patch`, and bash. The default formatter still formats the result, and the status stays. The `extension-failed` error note of an `EXTENSION_FAILED` error stays.
- `directories-created` in the write tools. `FileChange.createdDirectories` still lists the new folders.
- `hook-failed` in the write tools. A hook that throws after the commit still does not fail the call.
- `spill-failed` in bash. The command is still not affected, and `output.spill` is `null`.

The `formatterFailed` entry is gone from `ReadMessageCatalog` and `WriteMessageCatalog`. The `directoriesCreated` and `hookFailed` entries are gone from `WriteMessageCatalog`, and `spillFailed` is gone from `ShellMessageCatalog`.

### Remove the read-before-write-off note

With no state store, `edit`, `write`, and `apply_patch` no longer add the `read-before-write-off` warning note. The host chooses whether to give a store, and the model cannot change that choice, so the note used tokens and gave no value. The tools behave as before: with no store, they change a file without a read check. The `readBeforeWriteOff` entry is gone from `WriteMessageCatalog`.

### Remove internal words from note and error text

Six default messages used words that only make sense inside the package. They now say what happened in plain words:

- read `scan-limit`: "Scanning stopped at N bytes, so the total line count is unknown."
- read `not-a-file`: "PATH is a directory." The list of refused types and "before any content read" are gone.
- read and write `dangerous-path`: "PATH is refused by policy (DETAIL). Choose another path." The phrase "refused policy class" is gone.
- read `unsupported-backend`: "This host cannot read PATH (DETAIL). Do not retry."
- read `aborted`: "The read was aborted during the PHASE phase, so nothing was read."

The write `unsupported-backend` detail for a file that no classifier accepts is now "its file type is not supported". Codes, data, and catalog keys do not change. A host that matches the old text must update its match.

## @better-fs-tools/write@0.1.0

### First npm release

The first public release of the Better FS Tools packages. Each package ships compiled ES modules and TypeScript declarations from `dist/`.
