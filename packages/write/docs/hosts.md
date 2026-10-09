# Hosts and backends

This page helps you choose a host package and a filesystem backend. It lists what each one sets by default, and what each backend can do. The READMEs of the host and backend packages link here.

## Choose a bundle

Every bundle builds `read`, `edit`, and `write` over one backend, and `apply_patch` when the host asks for it. The tools share one digest, one lock manager, and one clock. With `state`, they also share one read store, so `edit` and `write` know what the model has read. `createFsTools()` is the portable core. The other three wrap it.

| Bundle                 | Package                   | Use it when                                                                                 |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `createFsTools()`      | `@better-fs-tools/write`  | You write your own host glue, or you run in a Worker with a Cloudflare or just-bash backend |
| `createNodeFsTools()`  | `@better-fs-tools/node`   | You run on Node or Bun and want the local filesystem                                        |
| `createPiFsTools()`    | `@better-fs-tools/pi`     | You write a Pi coding agent extension                                                       |
| `createAiSdkFsTools()` | `@better-fs-tools/ai-sdk` | You pass the tools to AI SDK 7 `generateText` or `streamText`, with any backend             |

The just-bash, Cloudflare Shell, and Cloudflare Computer packages are backends, not bundles. Pass their filesystem as `fs` to `createFsTools()` or `createAiSdkFsTools()`.

## Bundle defaults

| Setting                           | `createFsTools()`                                                     | `createNodeFsTools()`                                                                             | `createPiFsTools()`                                                                        | `createAiSdkFsTools()`                                                |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `fs`                              | required: a backend, or a factory of the call                         | `nodeFileSystem({ cwd, allowedRoots: [cwd] })`, `cwd` default `process.cwd()`                     | a `nodeFileSystem` rooted at `ctx.cwd` on each call. `fs`, `cwd`, and `allowedRoots` throw | required, as in `createFsTools()`                                     |
| Tool input                        | canonical                                                             | canonical                                                                                         | the Pi signatures below                                                                    | the AI SDK signatures below, `strict: true`                           |
| `state`                           | `null`: no read-before-write. `memoryStore({ clock })` turns it on    | `null`, as `createFsTools()`                                                                      | `null`, as `createFsTools()`                                                               | `null`, as `createFsTools()`                                          |
| `applyPatch`                      | off. `true` or an options object adds `apply_patch`                   | off, as `createFsTools()`                                                                         | off, as `createFsTools()`. The `pi.extensions` entry does not register it                  | off, as `createFsTools()`. When off, `tools` has no `apply_patch` key |
| `digest`                          | `sha256Digest()`, plain JavaScript                                    | `nodeDigest()`                                                                                    | `nodeDigest()`                                                                             | `sha256Digest()`                                                      |
| `locks`                           | `memoryLocks()`                                                       | `memoryLocks()`                                                                                   | `memoryLocks()`                                                                            | `memoryLocks()`                                                       |
| `clock`                           | `() => new Date()`                                                    | `() => new Date()`                                                                                | `() => new Date()`                                                                         | `() => new Date()`                                                    |
| `bash`                            | off. An options object with `runner` and `env` adds it. `true` throws | off. `true` or an options object adds it                                                          | none. Register `createPiBashTool()` on its own                                             | off. An options object with `runner` and `env` adds it. `true` throws |
| bash `runner`                     | required                                                              | `nodeCommandRunner({ cwd })`                                                                      | `createPiBashTool()`: a Node runner at `ctx.cwd`                                           | required                                                              |
| bash `env`                        | required                                                              | `shellEnv(() => process.env)`                                                                     | `createPiBashTool()`: `shellEnv(() => process.env)`                                        | required                                                              |
| New file and directory modes      | the backend's                                                         | `0o666` and `0o777` less the process umask. `newFileMode` and `newDirectoryMode` set them exactly | as Node                                                                                    | the backend's                                                         |
| `symlinks`, `identity`, buffering | the backend's                                                         | `"follow-within-roots"`, `"required"`, streams                                                    | as Node                                                                                    | the backend's                                                         |
| `invalidate`                      | `(path, call?)`                                                       | `(path, call?)`, `call` ignored                                                                   | `(path, call?)`, pass the call                                                             | `(path, call?)`                                                       |

In every bundle, a shared key (`fs`, `state`, `digest`, `locks`, `clock`) inside one tool's options throws `TypeError`, and so does an unknown option key. A bundle takes `state` as one store or `null`. The single tools also take a per-call store factory; a bundle does not, and throws a `TypeError` that names the bundle. The bash tool gets the bundle's digest and clock, so `ctx.digest` and `ctx.clock` in a bash hook match the file tools. The allowed roots never limit what a bash command touches.

### Tool signatures

A signature is the model-facing shape of a tool. The core and Node tools take the canonical input and have no signature. Pi and the AI SDK each default to the shape their models know.

| Tool          | Canonical input (core, Node)                           | Pi default                                                                  | AI SDK default                                                                                |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `read`        | `{ path, offset?, limit? }`                            | `defaultReadSignature({ name: "read" })`: `read({ path, offset?, limit? })` | `defaultReadSignature()`: `read({ path, offset?, limit? })`                                   |
| `edit`        | `{ path, edits: [{ oldText, newText, replaceAll? }] }` | `multiEditSignature()`: `edit({ path, edits: [{ oldText, newText }] })`     | `defaultEditSignature()`: `edit({ path, old_string, new_string, replace_all? })`              |
| `write`       | `{ path, content }`                                    | `defaultWriteSignature()`: `write({ path, content })`                       | `defaultWriteSignature()`: `write({ path, content })`                                         |
| `apply_patch` | `{ patch }`                                            | `freeformPatchSignature()`: `apply_patch({ patch })` plus the Codex grammar | `defaultPatchSignature()`: `apply_patch({ patch })` as JSON                                   |
| `bash`        | `{ command, timeoutMs?, cwd? }`                        | `createPiBashTool()`: `bash({ command, timeout? })`, seconds, no `cwd`      | `defaultBashSignature({ runner, limits })`: `bash({ command, timeout?, cwd? })`, milliseconds |

Every preset takes `name`, `description`, `describe`, and `names`. `names` renames a parameter, keyed by the preset's own parameter names.

### Single-tool factories

Each tool also has its own factory. A single factory shares nothing with another one: each write tool makes its own lock manager, and there is no read store unless you pass one. Use a bundle when a host installs more than one tool.

| Factory                                                                               | `state` | `digest`                                    | bash `env`                    |
| ------------------------------------------------------------------------------------- | ------- | ------------------------------------------- | ----------------------------- |
| `createReadTool()`, `createEditTool()`, `createWriteTool()`, `createApplyPatchTool()` | none    | none. A `state` without a `digest` throws   | none                          |
| `createBashTool()`                                                                    | none    | none                                        | required                      |
| `createNodeReadTool()` and the Node write tools                                       | none    | `nodeDigest()`. `digest: null` turns it off | none                          |
| `createNodeBashTool()`                                                                | none    | none                                        | `shellEnv(() => process.env)` |
| `createPiReadTool()` and the Pi write tools                                           | none    | `nodeDigest()`                              | none                          |
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

| Backend                          | Several `allowedRoots`            | `denyRoots`                           | `cwd` default          | Write methods                         | `stage()` | `remove()` | New file mode            |
| -------------------------------- | --------------------------------- | ------------------------------------- | ---------------------- | ------------------------------------- | --------- | ---------- | ------------------------ |
| `nodeFileSystem()`               | yes                               | yes, added to `/dev`, `/proc`, `/sys` | `process.cwd()`        | always                                | yes       | yes        | `0o666` less the umask   |
| `memoryFileSystem()`             | no, every absolute path is inside | yes                                   | none                   | always. `readOnly: true` refuses them | yes       | yes        | `0o644`                  |
| `justBashFileSystem()`           | yes                               | yes                                   | `/`                    | checked at use                        | no        | yes        | `0o644`                  |
| `cloudflareShellFileSystem()`    | yes                               | yes                                   | the first allowed root | checked at use                        | no        | yes        | none: Shell has no modes |
| `cloudflareComputerFileSystem()` | yes                               | yes                                   | the first allowed root | checked at use                        | no        | yes        | `0o644`                  |

- "Checked at use": the adapter builds over a backend object without its write methods. Reads work, and a write gives `unsupported`, which the write tools report as `UNSUPPORTED_BACKEND`.
- A deny root gives `dangerous-path` in every backend.
- A file over `maxBufferedBytes` gives `too-large`, which the tools report as `TOO_LARGE`.
- `readOnlyFileSystem(fs)` from `@better-fs-tools/fs` works over every backend. It keeps `open`, `list`, and the value members except `writeCapabilities`, such as `id`, `capabilities`, `paths`, and the root settings, so a read tool works and a write tool refuses it when it is built.

### Buffered reads and authorization

The read tool calls `authorize` after `fs.open()` and before it reads any content byte. A buffered backend (just-bash and Cloudflare Shell) has already fetched the whole file inside `open()`, so those bytes have left the backend before `authorize` runs. Cloudflare Computer opens the read stream in `open()`: the request reaches the backend, but no chunk is read. In every backend, the core passes no content byte to a classifier, a converter, or the model until `authorize` allows it.

If a denied read must not reach the backend at all, refuse the path in the backend itself, with `denyRoots` or by leaving it out of `allowedRoots`. The write tools are not affected: they authorize after `stat`, before they open the file.
