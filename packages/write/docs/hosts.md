# Hosts and backends

This page helps you choose a host package and a filesystem backend. It lists what each one sets by default, and what each backend can do. The READMEs of the host and backend packages link here. The docs site has the same facts on [Choose an integration](https://better-fs-tools.gandrew.com/integrations) and [Filesystems](https://better-fs-tools.gandrew.com/filesystems).

## Choose a bundle

Every bundle builds `read`, `edit`, and `write` over one backend, and `apply_patch` when the host asks for it. The tools share one digest, one lock manager, and one clock. With `state`, they also share one read store, so `edit` and `write` know what the model has read. `createFsTools()` is the portable core. The Pi and AI SDK bundles wrap it.

| Bundle                 | Package                   | Use it when                                                                                 |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `createFsTools()`      | `@better-fs-tools/write`  | You write your own host glue, or you run in a Worker with a Cloudflare or just-bash backend |
| `createPiFsTools()`    | `@better-fs-tools/pi`     | You write a Pi coding agent extension                                                       |
| `createAiSdkFsTools()` | `@better-fs-tools/ai-sdk` | You pass the tools to AI SDK 7 `generateText` or `streamText`, with any backend             |

`createAgentCoreFsTools()` from `@better-fs-tools/pi/agent-core` and `createDurableFsTools()` from `@better-fs-tools/pi-durable` are bundles too. They take the option keys of `createFsTools()` and have the same defaults as `createAiSdkFsTools()`. [Where integrations differ](#where-integrations-differ) lists each exception.

The Node, just-bash, Cloudflare Shell, and Cloudflare Computer packages are backends, not bundles. Pass their filesystem as `fs` to `createFsTools()` or `createAiSdkFsTools()`. On Node or Bun, use `createFsTools({ fs: nodeFileSystem({ allowedRoots: [process.cwd()] }) })` for the local filesystem. For a local `bash`, add `bash: { runner: nodeCommandRunner(), env: shellEnv(() => process.env) }`.

## Bundle defaults

| Setting                           | `createFsTools()`                                                     | `createPiFsTools()`                                                                        | `createAiSdkFsTools()`                                                |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `fs`                              | required: a backend, or a factory of the call                         | a `nodeFileSystem` rooted at `ctx.cwd` on each call. `fs`, `cwd`, and `allowedRoots` throw | required, as in `createFsTools()`                                     |
| Tool input                        | canonical                                                             | the shared default signatures below                                                        | the shared default signatures below, `strict: true`                   |
| `state`                           | `null`: no read-before-write. `memoryStore({ clock })` turns it on    | `null`, as `createFsTools()`                                                               | `null`, as `createFsTools()`                                          |
| `applyPatch`                      | off. `true` or an options object adds `apply_patch`                   | off, as `createFsTools()`. The `pi.extensions` entry does not register it                  | off, as `createFsTools()`. When off, `tools` has no `apply_patch` key |
| `digest`                          | `sha256Digest()`, plain JavaScript                                    | `nodeDigest()`                                                                             | `sha256Digest()`                                                      |
| `locks`                           | `memoryLocks()`                                                       | `piMutationQueueLocks()`: Pi's own per-file queue                                          | `memoryLocks()`                                                       |
| `clock`                           | `() => new Date()`                                                    | `() => new Date()`                                                                         | `() => new Date()`                                                    |
| `bash`                            | off. An options object with `runner` and `env` adds it. `true` throws | none. Register `createPiBashTool()` on its own                                             | off. An options object with `runner` and `env` adds it. `true` throws |
| bash `runner`                     | required                                                              | `createPiBashTool()`: a Node runner at `ctx.cwd`                                           | required                                                              |
| bash `env`                        | required                                                              | `createPiBashTool()`: `shellEnv(() => process.env)`                                        | required                                                              |
| New file and directory modes      | the backend's                                                         | as Node                                                                                    | the backend's                                                         |
| `symlinks`, `identity`, buffering | the backend's                                                         | as Node                                                                                    | the backend's                                                         |
| `invalidate`                      | `(path, call?)`                                                       | `(path, call?)`, pass the call                                                             | `(path, call?)`                                                       |

`sha256Digest()` and `nodeDigest()` give the same digest, with the id `sha256`. `nodeDigest()` uses `node:crypto`. `sha256Digest()` is plain JavaScript, so it runs in a Worker.

In every bundle, a shared key (`fs`, `state`, `digest`, `locks`, `clock`) inside one tool's options throws `TypeError`, and so does an unknown option key. A bundle takes `state` as one store or `null`. The single tools also take a per-call store factory; a bundle does not, and throws a `TypeError` that names the bundle. The bash tool gets the bundle's digest and clock, so `ctx.digest` and `ctx.clock` in a bash hook match the file tools. The allowed roots never limit what a bash command touches.

### Tool signatures

A signature is the model-facing shape of a tool. The core and Node tools take the canonical input and have no signature. Every integration (Pi, pi-agent-core, pi-durable, and the AI SDK) has the same default signatures. No integration sets a host's own prompt text or output schema by default.

| Tool          | Canonical input (core, Node)                           | Default signature in every integration                                                        |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `read`        | `{ path, offset?, limit? }`                            | `defaultReadSignature()`: `read({ path, offset?, limit? })`                                   |
| `edit`        | `{ path, edits: [{ oldText, newText, replaceAll? }] }` | `defaultEditSignature()`: `edit({ path, old_string, new_string, replace_all? })`              |
| `write`       | `{ path, content }`                                    | `defaultWriteSignature()`: `write({ path, content })`                                         |
| `apply_patch` | `{ patch }`                                            | `defaultPatchSignature()`: `apply_patch({ patch })` as JSON                                   |
| `bash`        | `{ command, timeoutMs?, cwd? }`                        | `defaultBashSignature({ runner, limits })`: `bash({ command, timeout?, cwd? })`, milliseconds |

To give a model other names, pass a default signature with options as the tool's `signature`. For example, `defaultBashSignature({ timeoutUnit: "s", cwd: false })` gives `bash({ command, timeout? })` in seconds. Every default signature takes `name`, `description`, `describe`, and `names`. `names` renames a parameter, keyed by the signature's own parameter names. For another shape, write your own signature.

### Where integrations differ

An integration keeps a default of its own only for a technical need of its host.

| Integration                           | Setting                             | Default                                                   | Reason                                                                                                                                                        |
| ------------------------------------- | ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi                                    | `locks`                             | `piMutationQueueLocks()`                                  | Pi's own tools and other extensions change files through Pi's per-file queue. Without it, two changes to one file can overlap.                                |
| Pi                                    | `promptSnippet`, `promptGuidelines` | the first sentence of the signature description, and `[]` | Pi lists a tool under "Available tools" only when it has a snippet. The text comes from the shared signature.                                                 |
| Pi                                    | renderers                           | `piToolRenderers()` in the extension entry                | Pi draws a tool named `read`, `edit`, `write`, or `bash` with its built-in renderer, which reads Pi's argument names. The resolver maps the shared arguments. |
| Pi, Node                              | `digest`                            | `nodeDigest()`                                            | The runtime is Node. In a Worker, `sha256Digest()` gives the same hash.                                                                                       |
| Pi, pi-durable                        | `fs`, `cwd`, `allowedRoots`         | the call's working directory                              | The host gives the working directory on each call. pi-durable takes `allowedRoots`, `denyRoots`, and `symlinks` relative to it.                               |
| pi-durable                            | `outputLimits`                      | 128 KiB and 4,000 lines                                   | The Harness cuts tool output again. These limits are above the `read` view, so the output is not cut twice.                                                   |
| pi-durable                            | bash `runner`, `env`                | the environment's `exec()`, with its own variables        | Commands run in the call's execution environment, which can be remote.                                                                                        |
| pi-durable                            | `name`, `state: "document"`         | `"better-fs-tools"`, and `state` stays `null`             | Durable extensions have names. `"document"` is an extra `state` value that keeps read records in the conversation.                                            |
| Pi, pi-agent-core, pi-durable, AI SDK | `read.converters`                   | `[imageConverter()]`                                      | Open decision: images are on in the integrations and off in the core and Node.                                                                                |

### Single-tool factories

Each tool also has its own factory. A single factory shares nothing with another one: each write tool makes its own lock manager, and there is no read store unless you pass one. Use a bundle when a host installs more than one tool.

| Factory                                                                               | `state` | `digest`                                    | bash `env`                    |
| ------------------------------------------------------------------------------------- | ------- | ------------------------------------------- | ----------------------------- |
| `createReadTool()`, `createEditTool()`, `createWriteTool()`, `createApplyPatchTool()` | none    | none. A `state` without a `digest` throws   | none                          |
| `createBashTool()`                                                                    | none    | none                                        | required                      |
| `createPiReadTool()` and the Pi write tools                                           | none    | `nodeDigest()`. `digest: null` turns it off | none                          |
| `createPiBashTool()`                                                                  | none    | none                                        | `shellEnv(() => process.env)` |
| `createAiSdkReadTool()` and the AI SDK write tools                                    | none    | none. A `state` without a `digest` throws   | none                          |
| `createAiSdkBashTool()`                                                               | none    | none                                        | required                      |

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
