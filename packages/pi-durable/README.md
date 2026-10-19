<a href="https://betterfs.dev"><img src="https://betterfs.dev/brand/D-wordmark-auto.svg" alt="Better FS Tools" height="64"></a>

# @better-fs-tools/pi-durable

Better FS Tools for [`@earendil-works/pi-durable`](https://www.npmjs.com/package/@earendil-works/pi-durable), the experimental durable harness of Pi. It replaces the `read`, `edit`, and `write` of `CodingTools`, and can add `apply_patch` and `bash`. Each call reads and writes through the call's execution environment, so the tools work on the local machine, over SSH with `@earendil-works/pi-env`, and in a container.

`@earendil-works/pi-durable` is experimental. Its API can change in each release. This package follows pi-durable 1.2.

## Install

```sh
npm install @better-fs-tools/pi-durable @earendil-works/pi-durable @earendil-works/chord typebox
```

`@earendil-works/pi-durable` (`~1.2.0`), `@earendil-works/chord` (`~1.2.0`), and `typebox` (`^1.3.16`) are required peers. The package imports no `node:` module.

## Example

Install the extension after `CodingTools`. When two extensions have a tool with the same name, the one installed later wins. In the first registry, `read`, `edit`, and `write` come from Better FS Tools, and `bash` stays from `CodingTools`. The second registry has the recommended configuration:

```ts
import { createRegistry } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import {
  createDurableFsTools,
  documentReadStore,
  durableEnvFileSystem,
  durableEnvRunner,
} from "@better-fs-tools/pi-durable";
import { shellEnv } from "@better-fs-tools/shell";

// Installed after CodingTools, so its read, edit, and write win. The bash of
// CodingTools stays.
export function fsToolsRegistry() {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(
    createDurableFsTools({
      fs: durableEnvFileSystem(), // each call reads and writes through its ExecutionEnv
    }),
  );
  return registry;
}

// The recommended configuration: read records in the conversation's
// documents, so they stay after a restart and follow a fork, and bash over the
// environment's exec() in place of the bash of CodingTools.
export function recommendedRegistry() {
  const registry = createRegistry();
  registry.install(CodingTools);
  registry.install(
    createDurableFsTools({
      fs: durableEnvFileSystem({ allowedRoots: ["."] }),
      state: documentReadStore(),
      bash: { runner: durableEnvRunner(), env: shellEnv() },
    }),
  );
  return registry;
}
```

Give the registry to `Harness.open()` with an `env` option, as for `CodingTools`.

## What the extension does

- `createDurableFsTools(options)` takes the options of `createFsTools()`, with the same defaults, plus a `signature` in each tool's options and the Harness settings `name` and `outputLimits`. `fs` is required. bash needs a `runner` and an `env`, and `bash: true` throws. `docs/hosts.md` in `@better-fs-tools/write` has the full table.
- The host of each call is `{ api, env, context }`: the tool API, the `ExecutionEnv` of the call, and its Chord context. Host functions, such as an authorizer, get it as `ctx.call.host`. A factory `fs`, `state`, or `runner` gets the call. A call without an environment fails with an error result.
- `read` is `replay: "safe"`, so the Harness runs it again after a crash. `edit`, `write`, and `apply_patch` keep the default `"unsafe"`: after a crash the model gets an interrupted result and reads the file again.
- `outputLimits` defaults to 128 KiB and 4,000 lines, above the 2,000-line and 50 KiB view of `read`, so the Harness does not cut the output a second time. `name` defaults to `"better-fs-tools"`.
- A signature with a `grammar` sets `constrainedSampling`, as in the Pi integrations. For the Codex patch grammar, pass `applyPatch: { signature: freeformPatchSignature() }`. `edit: { signature: multiEditSignature() }` gives the `edits: [{ oldText, newText }]` input of Durable's own `edit`.
- A tool error is a result with `isError: true`. A nonzero bash exit, a timeout, and an error are error results too. No tool declares a `structuredOutputSchema`, so programs get the text.
- `locks` defaults to one `memoryLocks()` for every call of the extension. The keys get the environment id, so the same path in two environments does not wait. The tools do not share the queue of the `CodingTools` `edit` and `write`: pi-durable does not export it.

## Recommended configuration

These choices suit the durable harness. They are options, not defaults:

- `fs: durableEnvFileSystem()`: each call reads and writes through the call's `ExecutionEnv`, so the tools work on the local machine, over SSH with pi-env, and in a container. `allowedRoots` is relative to the environment's `cwd`, and defaults to `["."]`. It also takes `denyRoots` and `symlinks`.
- `state: documentReadStore()`: each read record is a `ReadStateDoc` document of the conversation. The records stay after a restart, so an `edit` in the next process needs no new read. A fork starts with the records its parent had at the fork entry. A `ReadStateStore`, such as `memoryStore()`, is shared by every conversation in place.
- `bash: { runner: durableEnvRunner(), env: shellEnv() }`: commands run through the environment's `exec()`. A `cwd` from the model is relative to the environment's `cwd`. By default a command keeps the environment's own variables, with `defaultShellEnv` over them: `durableEnvRunner({ inheritEnv: false })` makes `env` the whole environment.

## The parts

| Export                                                   | What it is                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `createDurableFsTools(options)`                          | The extension                                                                |
| `durableEnvFileSystem(options?)`                         | A per-call `fs`: `executionEnvFileSystem()` over the call's environment      |
| `durableEnvRunner(options?)`                             | A per-call bash `runner`: `executionEnvRunner()` over the call's environment |
| `documentReadStore()`                                    | A per-call `state` in the conversation's `ReadStateDoc` documents            |
| `executionEnvFileSystem(env, { context, allowedRoots })` | A `WritableFileSystem` over any `ExecutionEnv`, for any tool or bundle       |
| `executionEnvRunner(env, { context })`                   | A bash `CommandRunner` over `env.exec()`                                     |
| `ReadStateDoc`                                           | The document family of the read records                                      |

`executionEnvFileSystem()` passes the filesystem and write conformance suites of `@better-fs-tools/fs`. Paths are POSIX paths in the environment. A path is checked against the roots as written, and again after its symbolic links resolve. A write through a dangling symbolic link is refused. Reads stream through `openBinaryReader()`. Writes use the environment's `writeFile()`, which replaces the content in place: the file keeps its mode, but the write is not atomic. Versions are weak: size and modification time.

## Links

- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): `createFsTools()`, the write options, and the guards
- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option and the signatures
- [`@better-fs-tools/pi`](https://www.npmjs.com/package/@better-fs-tools/pi): the tools for the Pi coding agent and for pi-agent-core
