## @better-fs-tools/pi-durable@0.3.0

### New package: @better-fs-tools/pi-durable

Better FS Tools for `@earendil-works/pi-durable`, the experimental durable harness of Pi. `createDurableFsTools()` is an extension that replaces the `read`, `edit`, and `write` of `CodingTools`, and can add `apply_patch` and `bash`. It takes the options of `createFsTools()`, with the same defaults, plus the Harness settings `name` and `outputLimits`.

- `durableEnvFileSystem()` gives each call a filesystem over the call's `ExecutionEnv`, so the tools work on the local machine, over SSH with pi-env, and in a container. `executionEnvFileSystem()` is that filesystem, and it passes the filesystem and write conformance suites.
- `documentReadStore()` keeps read records in the conversation's documents. They stay after a restart and follow a fork.
- `durableEnvRunner()` runs bash commands through the environment's `exec()`.
- `read` is safe to replay. A tool error is an error result.

pi-durable is experimental, so this package follows pi-durable 1.2 (`~1.2.0`).

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
