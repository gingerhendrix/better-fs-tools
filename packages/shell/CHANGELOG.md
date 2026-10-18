## @better-fs-tools/shell@0.3.0

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
