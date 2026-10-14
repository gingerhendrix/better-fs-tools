## @better-fs-tools/read@0.2.0

### Minimal defaults for notebooks, hard links, and the read view

Three more defaults now follow the most common behaviour of other agent harnesses. Each old behaviour is one option away.

| Old default                                                                                                                    | New default                                                                                                                                   | Option that brings the old behaviour back                      |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `defaultClassifiers()` has `notebookClassifier()`, so read refuses a `.ipynb` file, and edit and write refuse it as `NOT_TEXT` | A notebook is JSON text. `defaultClassifiers()` is image, pdf, office, binary, utf8                                                           | `classifiers: [notebookClassifier(), ...defaultClassifiers()]` |
| `nodeFileSystem`, `createNodeFsTools()`, and the Pi tools refuse to replace a file with more than one hard link                | `hardLinks: "in-place"`: the file is written through the link, not atomically. A file with one link is still replaced by temp file and rename | `hardLinks: "refuse"`                                          |
| `maxViewBytes` is 128 KiB                                                                                                      | 50 KiB. `maxLines` and `maxCharsPerLine` stay at 2 000                                                                                        | `limits: { maxViewBytes: 128 * 1_024 }`                        |

`notebookClassifier()` and `notebookConverter()` are still exported. The converter accepts code `NOTEBOOK`, so it needs `notebookClassifier()` in the chain. The write tools use the same classifiers, so with the default list `nonTextGuard()` in `recommendedGuards()` no longer refuses a notebook. The same `classifiers` option turns that refusal back on.

### Remove the capability notes from read results

`read` no longer adds the `weak-identity` and `buffered-backend` info notes. The model cannot act on either note, so they used tokens and gave no value. The `identity` capability stays. `identity: false` still sets `file.identity` to `null`, and the write tools still judge freshness by the content hash. The `weakIdentity` and `bufferedBackend` entries are gone from `ReadMessageCatalog`.

### Remove notes that only the host can act on

The tools no longer add notes that the model cannot act on:

- `extension-failed` from a failed formatter, in read, `edit`, `write`, `apply_patch`, and bash. The default formatter still formats the result, and the status stays. The `extension-failed` error note of an `EXTENSION_FAILED` error stays.
- `directories-created` in the write tools. `FileChange.createdDirectories` still lists the new folders.
- `hook-failed` in the write tools. A hook that throws after the commit still does not fail the call.
- `spill-failed` in bash. The command is still not affected, and `output.spill` is `null`.

The `formatterFailed` entry is gone from `ReadMessageCatalog` and `WriteMessageCatalog`. The `directoriesCreated` and `hookFailed` entries are gone from `WriteMessageCatalog`, and `spillFailed` is gone from `ShellMessageCatalog`.

### Remove internal words from note and error text

Six default messages used words that only make sense inside the package. They now say what happened in plain words:

- read `scan-limit`: "Scanning stopped at N bytes, so the total line count is unknown."
- read `not-a-file`: "PATH is a directory." The list of refused types and "before any content read" are gone.
- read and write `dangerous-path`: "PATH is refused by policy (DETAIL). Choose another path." The phrase "refused policy class" is gone.
- read `unsupported-backend`: "This host cannot read PATH (DETAIL). Do not retry."
- read `aborted`: "The read was aborted during the PHASE phase, so nothing was read."

The write `unsupported-backend` detail for a file that no classifier accepts is now "its file type is not supported". Codes, data, and catalog keys do not change. A host that matches the old text must update its match.

## @better-fs-tools/read@0.1.0

### First npm release

The first public release of the Better FS Tools packages. Each package ships compiled ES modules and TypeScript declarations from `dist/`.
