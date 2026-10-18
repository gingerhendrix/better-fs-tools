## @better-fs-tools/pi@0.3.0

### The Pi package needs Pi 1.x

The `@earendil-works/pi-coding-agent` peer range is now `^1.0.0`. Pi versions before 1.0 are not supported. The tools type-check and pass their tests against Pi 1.2.0.

To keep Pi 0.84, stay on `@better-fs-tools/pi` 0.2.

### Tools for Pi agent core

`@better-fs-tools/pi/agent-core` gives the tools as `AgentTool` objects for `@earendil-works/pi-agent-core`. `createAgentCoreFsTools()` returns `read`, `edit`, and `write`, and optionally `apply_patch` and `bash`. Put `tools` in `agent.state.tools` or in an `agentLoop()` context. `createAgentCoreReadTool()`, `createAgentCoreEditTool()`, `createAgentCoreWriteTool()`, `createAgentCoreApplyPatchTool()`, and `createAgentCoreBashTool()` build one tool each.

The factories take the options of the core factories and `createFsTools()`, with the same defaults, over any writable filesystem. A tool error is a result with `isError: true`, and `read` is marked as safe to replay. The module imports no Node module and no Pi package at run time, so it runs in a browser or a Worker.

### piMutationQueueLocks() shares Pi's per-file queue

`piMutationQueueLocks()` is a lock manager on Pi's own `withFileMutationQueue()`. Pass it as `locks` to `createPiFsTools()` or a Pi write tool, so a Better FS Tools `edit` and Pi's own `edit` or `write` on the same file wait for each other. The `./extension` entry uses it. `piMutationQueueLocks({ timeoutMs })` waits 30 seconds by default.

### Pi tool errors set isError, and the tools carry annotations

The Pi tools now set the Pi 1.x result fields:

- Every tool returns `isError: true` for a tool error. Before, Pi recorded a failed call as a success. `bash` also sets it for a nonzero exit and a timeout, as Pi's own `bash` does.
- Each file tool sets `annotations`: `readOnlyHint: true` on `read`, and `destructiveHint: true` on `edit`, `write`, and `apply_patch`. Permission extensions can read them.
- No tool declares an `outputSchema` or returns `structuredContent`. A codemode script gets the text of the result, and a result with `isError: true` makes the call reject.

`PiReadToolResult`, `PiMutationToolResult`, and `PiBashToolResult` have a new required `isError` field. Code that builds these results by hand must set it.

### One interface and one set of defaults across the core and every integration

Every factory now has the same options and the same defaults, in three layers:

- **Core.** `createReadTool()`, `createEditTool()`, `createWriteTool()`, `createApplyPatchTool()`, `createBashTool()`, and `createFsTools()` take `ReadToolOptions`, `EditToolOptions`, `WriteToolOptions`, `ApplyPatchToolOptions`, `BashToolOptions`, and `FsToolsOptions`. `fs` is required. bash needs `runner` and `env`.
- **Definitions.** `readToolDefinition()`, `editToolDefinition()`, `writeToolDefinition()`, `applyPatchToolDefinition()`, `bashToolDefinition()`, and `fsToolDefinitions()` in the `./signature` subpaths bind a core tool to its signature. A definition has the name, description, and JSON Schema to declare, a `validate` for model input, and an `execute` that maps model input and runs the tool. Use them to connect the tools to a framework of your own.
- **Integrations.** The AI SDK, Pi, pi-agent-core, and pi-durable factories are adapters over the definitions. They take the core options, plus `signature`, plus only the options that their host needs for display or registration: `contextSchema`, `promptSnippet`, `promptGuidelines`, `name`, and `outputLimits`.

**Defaults**

| Option            | Default everywhere                             |
| ----------------- | ---------------------------------------------- |
| `digest`          | `sha256Digest()`. `null` turns it off          |
| `read.converters` | `[imageConverter()]`. `[]` turns images off    |
| `locks`           | `memoryLocks()`                                |
| `state`           | `null`. A bundle also takes a per-call factory |
| bash `cwd`        | the runner's `cwd`                             |

`StateNeedsDigest` is the one type for the pairing of `state` and `digest`.

**Host choices are options**

- Pi: `fs: piCwdFileSystem()` and `runner: piCwdCommandRunner()` from the new `@better-fs-tools/pi/node` subpath root each call at `ctx.cwd`. `locks: piMutationQueueLocks()` and `digest: nodeDigest()` are recommended. The `./extension` entry uses all three, so it behaves as before. `createPiFsTools()` takes `bash`. The main entry imports no Node module.
- pi-durable: `fs: durableEnvFileSystem()`, `state: documentReadStore()`, and `runner: durableEnvRunner()` replace the root options, `state: "document"`, `bash: true`, and `inheritEnv`.
- Node: `@better-fs-tools/node` has the backends only: `nodeFileSystem()`, `nodeCommandRunner()`, and `nodeDigest()`. Pass them to any tool or bundle.

**Signatures**

Every integration uses the default signatures: `defaultReadSignature()`, `defaultEditSignature()`, `defaultWriteSignature()`, `defaultPatchSignature()`, and `defaultBashSignature()`. Each takes `names` to rename a parameter. Three presets stay for shapes that names cannot give: `multiEditSignature()` (many replacements in one edit call), `lineRangeSignature()` (inclusive `start` and `end` lines), and `freeformPatchSignature()` (the Codex patch grammar). pi-durable now sends a signature's grammar as `constrainedSampling`, as the Pi and pi-agent-core integrations do.

**Removed**

`ReadToolDeps`, `EditToolDeps`, `WriteToolDeps`, `ApplyPatchToolDeps`, `ShellToolDeps`, `CreateFsToolsOptions`, the `Create…Options` integration types, the `XxxDependencies` types, `StateNeedsDigestOrDefault`, `PiAgentTool` and its variants, `camelCaseEditSignature()` and `snakeCaseWriteSignature()` (use `names` on the default signatures), `createNodeFsTools()`, `createNodeReadTool()`, `createNodeEditTool()`, `createNodeWriteTool()`, `createNodeApplyPatchTool()`, and `createNodeBashTool()`. The integration types take the names of their factories, for example `AiSdkReadToolOptions`, `PiFsToolsOptions`, and `AgentCoreReadTool`.

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
