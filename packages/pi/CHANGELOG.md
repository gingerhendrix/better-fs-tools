## @better-fs-tools/pi@0.3.0

### The Pi package needs Pi 1.x

The `@earendil-works/pi-coding-agent` peer range is now `^1.0.0`. Pi versions before 1.0 are not supported. The tools type-check and pass their tests against Pi 1.2.0.

To keep Pi 0.84, stay on `@better-fs-tools/pi` 0.2.

### Tools for Pi agent core

`@better-fs-tools/pi/agent-core` has `createAgentCoreFsTools()`. It returns `read`, `edit`, and `write`, and optionally `apply_patch` and `bash`, as `AgentTool` objects for `@earendil-works/pi-agent-core`. Put `tools` in `agent.state.tools` or in an `agentLoop()` context.

The bundle takes the options of `createFsTools()`, with any writable filesystem. It uses the signatures and output schemas of the coding agent's own tools, sets `isError: true` on a tool error, and marks `read` as safe to replay. The module imports no Node module and no Pi package at run time, so it runs in a browser or a Worker.

### The Pi write tools share Pi's per-file queue

`piMutationQueueLocks()` is a lock manager on Pi's own `withFileMutationQueue()`. It is now the default `locks` of `createPiFsTools()`, `createPiEditTool()`, `createPiWriteTool()`, and `createPiApplyPatchTool()`. A Better FS Tools `edit` and Pi's own `edit` or `write` on the same file now wait for each other. Before, the Pi tools used `memoryLocks()`, which Pi's own tools do not see.

Pass `locks: memoryLocks()` for the old behaviour. `piMutationQueueLocks({ timeoutMs })` waits 30 seconds by default.

### Pi tool errors set isError, and read and bash give structured output

The Pi tools now set the Pi 1.x result fields:

- Every tool returns `isError: true` for a tool error. Before, Pi recorded a failed call as a success. `bash` also sets it for a nonzero exit and a timeout, as Pi's own `bash` does.
- `read` and `bash` declare the `outputSchema` of Pi's own `read` and `bash`, and return a matching `structuredContent`. A codemode script that calls them gets the same value as from Pi's own tools. `edit`, `write`, and `apply_patch` declare no schema, as Pi's own `edit` and `write`.
- Each file tool sets `annotations`: `readOnlyHint: true` on `read`, and `destructiveHint: true` on `edit`, `write`, and `apply_patch`. Permission extensions can read them.

`PiReadToolResult`, `PiMutationToolResult`, and `PiBashToolResult` have a new required `isError` field. Code that builds these results by hand must set it.

## @better-fs-tools/pi@0.2.0

### The Pi and AI SDK read tools return images

`createPiReadTool()`, `createPiFsTools()`, the Pi extension entry, `createAiSdkReadTool()`, and `createAiSdkFsTools()` now add `imageConverter()` when you pass no `converters`. An image read gives a Pi `image` part, or an AI SDK `file` part. Before, the read refused the image as `unsupported`. Pi's own `read` returns images, so the Pi extension no longer takes that away.

The read core still has no converters by default. A `converters` list you pass replaces the default, so `converters: []` turns images off. In the bundles the option goes under `read`, for example `read: { converters: [] }`. A list without `imageConverter()` also refuses images.

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

## @better-fs-tools/pi@0.1.0

### First npm release

The first public release of the Better FS Tools packages. Each package ships compiled ES modules and TypeScript declarations from `dist/`.
