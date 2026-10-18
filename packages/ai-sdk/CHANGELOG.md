## @better-fs-tools/ai-sdk@0.3.0

### The AI SDK tools take a `contextSchema`

`createAiSdkReadTool()`, `createAiSdkEditTool()`, `createAiSdkWriteTool()`, `createAiSdkApplyPatchTool()`, `createAiSdkBashTool()`, and `createAiSdkFsTools()` take a new `contextSchema` option. The tool passes it to the AI SDK, which validates the `toolsContext` entry of the tool before `execute`. In the bundle, every tool gets the same schema.

The tool types now have an optional `contextSchema` field. With it, the AI SDK types accept a `toolsContext` of the factory's context type, for example `createAiSdkFsTools<{ root: string }>()`. Before, `generateText` refused any `toolsContext` for these tools, so a caller needed a cast. Because of the new field, a tool of one context type no longer fits a variable of another context type.

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

## @better-fs-tools/ai-sdk@0.2.0

### The Pi and AI SDK read tools return images

`createPiReadTool()`, `createPiFsTools()`, the Pi extension entry, `createAiSdkReadTool()`, and `createAiSdkFsTools()` now add `imageConverter()` when you pass no `converters`. An image read gives a Pi `image` part, or an AI SDK `file` part. Before, the read refused the image as `unsupported`. Pi's own `read` returns images, so the Pi extension no longer takes that away.

The read core still has no converters by default. A `converters` list you pass replaces the default, so `converters: []` turns images off. In the bundles the option goes under `read`, for example `read: { converters: [] }`. A list without `imageConverter()` also refuses images.

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

## @better-fs-tools/ai-sdk@0.1.0

### First npm release

The first public release of the Better FS Tools packages. Each package ships compiled ES modules and TypeScript declarations from `dist/`.
