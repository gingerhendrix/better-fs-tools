# @better-fs-tools/pi-durable

Better FS Tools for [`@earendil-works/pi-durable`](https://www.npmjs.com/package/@earendil-works/pi-durable), the experimental durable harness of Pi. It replaces the `read`, `edit`, and `write` of `CodingTools`, and can add `apply_patch` and `bash`. Each call reads and writes through the call's execution environment, so the tools work on the local machine, over SSH with `@earendil-works/pi-env`, and in a container.

`@earendil-works/pi-durable` is experimental. Its API can change in each release. This package follows pi-durable 1.2.

## Install

```sh
npm install @better-fs-tools/pi-durable @earendil-works/pi-durable @earendil-works/chord typebox
```

`@earendil-works/pi-durable` (`~1.2.0`), `@earendil-works/chord` (`~1.2.0`), and `typebox` (`^1.3.16`) are required peers. The package imports no `node:` module.

## Example

Install the extension after `CodingTools`. When two extensions have a tool with the same name, the one installed later wins. Here `read`, `edit`, and `write` come from Better FS Tools, and `bash` stays from `CodingTools`. The second registry turns read-before-write on with records in the conversation's documents:

```ts
import { createRegistry } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { createDurableFsTools } from "@better-fs-tools/pi-durable";

// Installed after CodingTools, so its read, edit, and write win. The bash of
// CodingTools stays.
export function fsToolsRegistry() {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(createDurableFsTools());
  return registry;
}

// Read-before-write is off by default. With state "document", the read
// records live in the conversation's documents, so they stay after a restart.
export function readFirstRegistry() {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(createDurableFsTools({ state: "document" }));
  return registry;
}
```

Give the registry to `Harness.open()` with an `env` option, as for `CodingTools`.

## What the extension does

- Each call builds its filesystem from `api.env`, the `ExecutionEnv` of the call. The only allowed root is the environment's `cwd`. Set `allowedRoots` (relative to that `cwd`), `denyRoots`, and `symlinks` to change it. A call without an environment fails with an error result.
- `state` defaults to `null`, as in every integration: read-before-write is off. `state: "document"` turns it on, and each read record is a `ReadStateDoc` document of the conversation. The records stay after a restart, so an `edit` in the next process needs no new read. A fork starts with the records its parent had at the fork entry. A `ReadStateStore`, such as `memoryStore()`, is shared by every conversation.
- `read` is `replay: "safe"`, so the Harness runs it again after a crash. `edit`, `write`, and `apply_patch` keep the default `"unsafe"`: after a crash the model gets an interrupted result and reads the file again.
- `outputLimits` defaults to 128 KiB and 4,000 lines, above the 2,000-line and 50 KiB view of `read`, so the Harness does not cut the output a second time.
- A tool error is a result with `isError: true`. `read`, `edit`, and `write` give programs their text, as the tools of `CodingTools` do.
- `locks` defaults to one `memoryLocks()` for every call of the extension. The keys are the environment id and the real path, so the same path in two environments does not wait. The tools do not share the queue of the `CodingTools` `edit` and `write`: pi-durable does not export it.
- `bash: true`, or an options object, adds `bash` over the environment's `exec()`, with `defaultBashSignature()`: `{ command, timeout?, cwd? }` with the timeout in milliseconds. A `cwd` from the model is relative to the environment's `cwd`. A command keeps the environment's own variables, with `defaultShellEnv` over them. A nonzero exit, a timeout, and an error are error results. No tool declares a `structuredOutputSchema`, so programs get the text.
- The default signatures are the shared defaults of every integration: `defaultReadSignature()`, `defaultEditSignature()`, `defaultWriteSignature()`, `defaultPatchSignature()`, and `defaultBashSignature()`. Each tool's options go under `read`, `edit`, `write`, `applyPatch`, and `bash`, with a `signature` to change the model-facing shape. For example, `edit: { signature: multiEditSignature() }` gives the `edits: [{ oldText, newText }]` input of Durable's own `edit`. Host functions, such as an authorizer, get `{ api, env, context }` as `ctx.call.host`.

## The parts

| Export                                                   | What it is                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| `createDurableFsTools(options?)`                         | The extension                                                         |
| `executionEnvFileSystem(env, { context, allowedRoots })` | A `WritableFileSystem` over any `ExecutionEnv`, for `createFsTools()` |
| `executionEnvRunner(env, { context })`                   | A bash `CommandRunner` over `env.exec()`                              |
| `documentReadStore(api, envId, context)`                 | A `ReadStateStore` in the conversation's `ReadStateDoc` documents     |
| `ReadStateDoc`                                           | The document family of the read records                               |

`executionEnvFileSystem()` passes the filesystem and write conformance suites of `@better-fs-tools/fs`. Paths are POSIX paths in the environment. A path is checked against the roots as written, and again after its symbolic links resolve. A write through a dangling symbolic link is refused. Reads stream through `openBinaryReader()`. Writes use the environment's `writeFile()`, which replaces the content in place: the file keeps its mode, but the write is not atomic. Versions are weak: size and modification time.

## Links

- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): `createFsTools()`, the write options, and the guards
- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option and the signatures
- [`@better-fs-tools/pi`](https://www.npmjs.com/package/@better-fs-tools/pi): the tools for the Pi coding agent and for pi-agent-core
