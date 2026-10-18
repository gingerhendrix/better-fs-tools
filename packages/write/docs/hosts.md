# Hosts and backends

This page helps you choose an integration and a filesystem backend. It lists the defaults that every integration shares, the few options that only one host has, a recommended configuration for each host, and what each backend can do. The READMEs of the integration and backend packages link here. The docs site has the same facts on [Choose an integration](https://betterfs.dev/integrations) and [Filesystems](https://betterfs.dev/filesystems).

## One interface in three layers

| Layer       | Factories                                                                                                                                                                          | Takes                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Core        | `createReadTool()`, `createEditTool()`, `createWriteTool()`, `createApplyPatchTool()`, `createBashTool()`, `createFsTools()`                                                       | `XxxToolOptions` and `FsToolsOptions`. `fs` is required. bash needs `runner` and `env` |
| Definitions | `readToolDefinition()`, `editToolDefinition()`, `writeToolDefinition()`, `applyPatchToolDefinition()`, `bashToolDefinition()`, `fsToolDefinitions()` in the `./signature` subpaths | the core options, plus `signature`                                                     |
| Integration | the AI SDK, Pi, pi-agent-core, and pi-durable factories                                                                                                                            | the core options, plus `signature`, plus host display or registration options          |

A definition binds a core tool to its signature: the name, description, and JSON Schema to declare, a `validate` for model input, and an `execute` that maps model input and runs the tool. Every integration is an adapter over the definitions, so a host of your own gets the same behaviour from them.

| Integration        | Single tools                                                                           | Bundle                                                |
| ------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| AI SDK 7           | `createAiSdkReadTool()` and the four others                                            | `createAiSdkFsTools()`                                |
| Pi coding agent    | `createPiReadTool()` and the four others                                               | `createPiFsTools()`                                   |
| Pi agent core      | `createAgentCoreReadTool()` and the four others, from `@better-fs-tools/pi/agent-core` | `createAgentCoreFsTools()`                            |
| Pi durable harness | none: tools register inside an extension                                               | `createDurableFsTools()`, which returns the extension |

The Node, just-bash, Cloudflare Shell, and Cloudflare Computer packages are backends, not integrations. Pass their filesystem as `fs`, and a runner as the bash `runner`, to any factory.

## Defaults

Every core tool, bundle, and integration has these defaults.

| Option                            | Default                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `fs`                              | required: a backend, or a factory of the call                                                                 |
| `state`                           | `null`: no read-before-write. A store, such as `memoryStore({ clock })`, or a factory of the call turns it on |
| `digest`                          | `sha256Digest()`, plain JavaScript. `null` turns observations off, and then `state` must be `null`            |
| `locks`                           | `memoryLocks()`                                                                                               |
| `clock`                           | `() => new Date()`                                                                                            |
| `read.converters`                 | `[imageConverter()]`: an image becomes a media part. `[]` turns images off                                    |
| `applyPatch` in a bundle          | off. `true` or an options object adds `apply_patch`                                                           |
| `bash` in a bundle                | off. An options object with `runner` and `env` adds it. `true` throws                                         |
| bash `runner`, `env`              | required                                                                                                      |
| bash `cwd`                        | the runner's `cwd`                                                                                            |
| New file and directory modes      | the backend's                                                                                                 |
| `symlinks`, `identity`, buffering | the backend's                                                                                                 |
| `invalidate` of a bundle          | `(path, call?)`. Pass the call when `fs` or `state` is a factory                                              |

`sha256Digest()` and `nodeDigest()` give the same digest, with the id `sha256`, so records made with one are valid for the other. `nodeDigest()` uses `node:crypto` and is faster. `sha256Digest()` runs in a Worker.

In every bundle, a shared key (`fs`, `state`, `digest`, `locks`, `clock`) inside one tool's options throws `TypeError`, and so does an unknown option key. The bash tool gets the bundle's digest and clock, so `ctx.digest` and `ctx.clock` in a bash hook match the file tools. The allowed roots never limit what a bash command touches.

A single-tool factory shares nothing with another one: each write tool makes its own lock manager, and there is no read store unless you pass one. Use a bundle when a host installs more than one tool.

### Tool signatures

A signature is the model-facing shape of a tool. The core tools take the canonical input. Every definition and integration has the same default signatures.

| Tool          | Canonical input (core)                                 | Default signature                                                                             |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `read`        | `{ path, offset?, limit? }`                            | `defaultReadSignature()`: `read({ path, offset?, limit? })`                                   |
| `edit`        | `{ path, edits: [{ oldText, newText, replaceAll? }] }` | `defaultEditSignature({ matchers })`: `edit({ path, old_string, new_string, replace_all? })`  |
| `write`       | `{ path, content }`                                    | `defaultWriteSignature()`: `write({ path, content })`                                         |
| `apply_patch` | `{ patch }`                                            | `defaultPatchSignature()`: `apply_patch({ patch })` as JSON                                   |
| `bash`        | `{ command, timeoutMs?, cwd? }`                        | `defaultBashSignature({ runner, limits })`: `bash({ command, timeout?, cwd? })`, milliseconds |

To give a model other names, pass a default signature with options as the tool's `signature`. For example, `defaultBashSignature({ timeoutUnit: "s", cwd: false })` gives `bash({ command, timeout? })` in seconds. Every default signature takes `name`, `description`, `describe`, and `names`. `names` renames a parameter, keyed by the signature's own parameter names. Three presets give another shape: `multiEditSignature()` gives `edit({ path, edits: [{ oldText, newText }] })` for many replacements in one call, `lineRangeSignature()` gives `read({ path, start?, end? })` with inclusive lines, and `freeformPatchSignature()` adds the Codex patch grammar. The Pi, pi-agent-core, and pi-durable integrations send that grammar as `constrainedSampling`. The AI SDK sends only the JSON schema. For any other shape, write your own signature.

### Host options

An integration adds options only for its host's display or registration. It changes no default.

| Integration | Options                             | Default                                                   | Why                                                                                                                                            |
| ----------- | ----------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| AI SDK      | `contextSchema`                     | none                                                      | The AI SDK validates the `toolsContext` entry of a tool with it.                                                                               |
| Pi          | `promptSnippet`, `promptGuidelines` | the first sentence of the signature description, and `[]` | Pi lists a tool under "Available tools" only when it has a snippet. The text comes from the shared signature.                                  |
| pi-durable  | `name`, `outputLimits`              | `"better-fs-tools"`, and 128 KiB and 4,000 lines          | Durable extensions have names. The Harness cuts tool output again, and these limits are above the `read` view, so the output is not cut twice. |

`piToolRenderers()` from `@better-fs-tools/pi` is a renderer resolver, not an option. Pi draws a tool named `read`, `edit`, `write`, or `bash` with its built-in renderer, which reads Pi's argument names. The resolver maps the shared arguments to them.

## Recommended configurations

Each host has choices that suit it. They are options, not defaults, so each one is visible in your code.

### Pi coding agent

The `./extension` entry of `@better-fs-tools/pi` uses the first three options. It registers `read`, `edit`, and `write`, so Pi keeps its own bash:

```ts
import { createPiFsTools, piMutationQueueLocks } from "@better-fs-tools/pi";
import { piCwdCommandRunner, piCwdFileSystem } from "@better-fs-tools/pi/node";
import { nodeDigest } from "@better-fs-tools/node";
import { shellEnv } from "@better-fs-tools/shell";

createPiFsTools({
  fs: piCwdFileSystem(), // a Node filesystem rooted at ctx.cwd on each call
  locks: piMutationQueueLocks(), // the per-file queue of Pi's own edit and write
  digest: nodeDigest(), // faster on Node than sha256Digest()
  // To replace Pi's own bash too:
  bash: { runner: piCwdCommandRunner(), env: shellEnv(() => process.env) },
});
```

Alternatives: `memoryLocks()` when no other extension writes files, `state: memoryStore()` for read-before-write, and `piCwdFileSystem({ denyRoots, symlinks })` to narrow the root.

### AI SDK on Node or Bun

```ts
import { createAiSdkFsTools } from "@better-fs-tools/ai-sdk";
import { nodeCommandRunner, nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { shellEnv } from "@better-fs-tools/shell";

const cwd = process.cwd();
createAiSdkFsTools({
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
  digest: nodeDigest(),
  bash: { runner: nodeCommandRunner({ cwd }), env: shellEnv(() => process.env) },
});
```

In a Worker, pass `cloudflareShellFileSystem()` or `justBashFileSystem()` as `fs` and keep the default digest.

### Pi agent core

```ts
import { createAgentCoreFsTools } from "@better-fs-tools/pi/agent-core";
import { memoryFileSystem } from "@better-fs-tools/fs";

createAgentCoreFsTools({ fs: memoryFileSystem() }); // any writable filesystem; no Node import
```

### Pi durable harness

```ts
import {
  createDurableFsTools,
  documentReadStore,
  durableEnvFileSystem,
  durableEnvRunner,
} from "@better-fs-tools/pi-durable";
import { shellEnv } from "@better-fs-tools/shell";

createDurableFsTools({
  fs: durableEnvFileSystem({ allowedRoots: ["."] }), // through the call's ExecutionEnv
  state: documentReadStore(), // read records follow the conversation and its forks
  bash: { runner: durableEnvRunner(), env: shellEnv() }, // the environment's exec()
});
```

## Backends

Every backend takes the shared `FileSystemRootOptions` from `@better-fs-tools/fs`. Its README has the option table and the write capability table.

| Backend                          | Package                                | Reads                      | Bytes fetched before `authorize`               | `maxBufferedBytes` | `symlinks`                            | `identity`                 |
| -------------------------------- | -------------------------------------- | -------------------------- | ---------------------------------------------- | ------------------ | ------------------------------------- | -------------------------- |
| `nodeFileSystem()`               | `@better-fs-tools/node`                | stream                     | none                                           | none               | both, default `"follow-within-roots"` | `"required"` only          |
| `memoryFileSystem()`             | `@better-fs-tools/fs`                  | from memory                | none: the bytes are already in memory          | 16 MiB             | links do not exist                    | both, default `"required"` |
| `justBashFileSystem()`           | `@better-fs-tools/just-bash`           | buffered in `open()`       | the whole file                                 | 16 MiB             | both, default `"reject"`              | both, default `"none"`     |
| `cloudflareShellFileSystem()`    | `@better-fs-tools/cloudflare-shell`    | buffered in `open()`       | the whole file                                 | 16 MiB             | `"reject"` only                       | `"none"` only              |
| `cloudflareComputerFileSystem()` | `@better-fs-tools/cloudflare-computer` | stream, opened in `open()` | the read request is sent, but no chunk is read | none               | `"reject"` only                       | `"none"` only              |

| Backend                          | Several `allowedRoots`            | `denyRoots`                           | `cwd` default          | Write methods                         | `stage()` | `remove()` | New file mode                                  |
| -------------------------------- | --------------------------------- | ------------------------------------- | ---------------------- | ------------------------------------- | --------- | ---------- | ---------------------------------------------- |
| `nodeFileSystem()`               | yes                               | yes, added to `/dev`, `/proc`, `/sys` | `process.cwd()`        | always                                | yes       | yes        | `0o666` less the umask                         |
| `memoryFileSystem()`             | no, every absolute path is inside | yes                                   | none                   | always. `readOnly: true` refuses them | yes       | yes        | `0o644`                                        |
| `justBashFileSystem()`           | yes                               | yes                                   | `/`                    | checked at use                        | no        | yes        | the backend's default. `0o644` in `InMemoryFs` |
| `cloudflareShellFileSystem()`    | yes                               | yes                                   | the first allowed root | checked at use                        | no        | yes        | none: Shell has no modes                       |
| `cloudflareComputerFileSystem()` | yes                               | yes                                   | the first allowed root | checked at use                        | no        | yes        | `0o644`                                        |

- "Checked at use": the adapter builds over a backend object without its write methods. Reads work, and a write gives `unsupported`, which the write tools report as `UNSUPPORTED_BACKEND`.
- A deny root gives `dangerous-path` in every backend.
- A file over `maxBufferedBytes` gives `too-large`, which the tools report as `TOO_LARGE`.
- `readOnlyFileSystem(fs)` from `@better-fs-tools/fs` works over every backend. It keeps `open`, `list`, and the value members except `writeCapabilities`, such as `id`, `capabilities`, `paths`, and the root settings, so a read tool works and a write tool refuses it when it is built.

### Buffered reads and authorization

The read tool calls `authorize` after `fs.open()` and before it reads any content byte. A buffered backend (just-bash and Cloudflare Shell) has already fetched the whole file inside `open()`, so those bytes have left the backend before `authorize` runs. Cloudflare Computer opens the read stream in `open()`: the request reaches the backend, but no chunk is read. In every backend, the core passes no content byte to a classifier, a converter, or the model until `authorize` allows it.

If a denied read must not reach the backend at all, refuse the path in the backend itself, with `denyRoots` or by leaving it out of `allowedRoots`. The write tools are not affected: they authorize after `stat`, before they open the file.
