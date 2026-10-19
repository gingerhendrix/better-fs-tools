<a href="https://betterfs.dev"><img src="https://betterfs.dev/brand/D-wordmark-auto.svg" alt="Better FS Tools" height="64"></a>

# @better-fs-tools/pi

Better FS Tools for the [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and for `@earendil-works/pi-agent-core`. It replaces Pi's built-in `read`, `edit`, and `write` tools, and can add `apply_patch` and `bash`. The tools take the options of every Better FS Tools integration, with the same defaults, plus Pi's prompt options. `piCwdFileSystem()` from the `./node` subpath confines each call to its working directory.

## Install

```sh
npm install @better-fs-tools/pi @better-fs-tools/read @better-fs-tools/write @earendil-works/pi-coding-agent typebox
```

`@earendil-works/pi-coding-agent` (`^1.0.0`) and `typebox` (`^1.3.16`) are required peers. Pi versions before 1.0 are not supported. The package needs Node 24 or later.

The package has a `pi.extensions` entry. When Pi loads the package, the entry registers `read`, `edit`, and `write` from `createPiFsTools()`. They replace Pi's own tools of those names. The entry uses the recommended Pi configuration: `fs: piCwdFileSystem()`, so each call reads and writes inside `ctx.cwd`; `locks: piMutationQueueLocks()`, so Pi's own `edit` and `write` wait for these tools; and `digest: nodeDigest()`. Every other option has the shared default: `read` returns images, and there is no read store, so `edit` and `write` do not check for a read first. The entry registers `piToolRenderers()` so that Pi's built-in renderers draw the tools. It writes no settings or session file.

## Example

To choose your own options, register the tools from your own extension:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiFsTools, piMutationQueueLocks, piToolRenderers } from "@better-fs-tools/pi";
import { piCwdFileSystem } from "@better-fs-tools/pi/node";
import { nodeDigest } from "@better-fs-tools/node";
import { denyPaths, memoryStore, unicodeRepair } from "@better-fs-tools/read";
import { hashlineFormat } from "@better-fs-tools/read/formats";
import { protectPaths } from "@better-fs-tools/write";

export default function fsToolsExtension(pi: ExtensionAPI): void {
  const tools = createPiFsTools({
    // The recommended Pi configuration, as in the package's extension entry.
    fs: piCwdFileSystem(), // a Node filesystem rooted at ctx.cwd on each call
    locks: piMutationQueueLocks(), // the per-file queue of Pi's own edit and write
    digest: nodeDigest(), // faster on Node than the default sha256Digest()
    // Opt-ins: one read store, so edit and write need a read first, and apply_patch.
    state: memoryStore(),
    read: {
      resolve: unicodeRepair({ note: false }),
      authorize: denyPaths(["**/.env", "**/.env.*"]),
      formatter: hashlineFormat(),
    },
    edit: { authorize: protectPaths() },
    write: { authorize: protectPaths() },
    applyPatch: { authorize: protectPaths() },
  });
  pi.registerTool(tools.read);
  pi.registerTool(tools.edit);
  pi.registerTool(tools.write);
  pi.registerTool(tools.applyPatch);
  // Pi's built-in read, edit, and write renderers draw the shared signatures.
  pi.registerToolRenderer(piToolRenderers([tools.read, tools.edit, tools.write]));
}
```

To register only the read tool:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiReadTool } from "@better-fs-tools/pi";
import { piCwdFileSystem } from "@better-fs-tools/pi/node";
import { denyPaths, unicodeRepair } from "@better-fs-tools/read";
import { hashlineFormat } from "@better-fs-tools/read/formats";
import { defaultReadSignature } from "@better-fs-tools/read/signature";

export default function readExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    createPiReadTool({
      fs: piCwdFileSystem(),
      signature: defaultReadSignature({ name: "read", names: { path: "file_path" } }),
      resolve: unicodeRepair({ note: false }),
      authorize: denyPaths(["**/.env", "**/.env.*"]),
      formatter: hashlineFormat(),
    }),
  );
}
```

## Use the Pi SDK

The tools also work with `createAgentSession()` from the Pi SDK. Give them to `customTools`. A custom tool with the name of a built-in tool replaces it:

```ts
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { createPiFsTools } from "@better-fs-tools/pi";
import { piCwdFileSystem } from "@better-fs-tools/pi/node";
import { memoryStore } from "@better-fs-tools/read";

const cwd = "/work/repo";
const tools = createPiFsTools({ fs: piCwdFileSystem(), state: memoryStore(), applyPatch: true });

// read, edit, and write have the names of Pi's built-in tools, so they replace
// them. Pi's own bash stays.
const { session } = await createAgentSession({
  cwd,
  sessionManager: SessionManager.inMemory(cwd),
  customTools: [tools.read, tools.edit, tools.write, tools.applyPatch],
});

try {
  await session.prompt("Rename greet() to welcome() in src/greet.ts.");
} finally {
  session.dispose();
}
```

The session's `cwd` is the root of every call. For `tools`, `noTools`, and inline extensions with hooks and guards, see [Use Pi from code (SDK)](https://betterfs.dev/integrations/pi#use-pi-from-code-sdk). For `pi-agent-core`, use `createAgentCoreFsTools()`: see [Pi agent core](#pi-agent-core) below. For the experimental `pi-durable` harness, use [`@better-fs-tools/pi-durable`](https://www.npmjs.com/package/@better-fs-tools/pi-durable).

## Options

Every Pi factory takes the options of the matching core factory, with the same defaults, plus `signature`, `promptSnippet`, and `promptGuidelines`:

| Factory                                                                 | Options                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `createPiReadTool(options)`                                             | `createReadTool()`: `fs` is required                                                                                |
| `createPiEditTool()`, `createPiWriteTool()`, `createPiApplyPatchTool()` | `createEditTool()`, `createWriteTool()`, `createApplyPatchTool()`: `fs` is required                                 |
| `createPiBashTool(options)`                                             | `createBashTool()`: `runner` and `env` are required                                                                 |
| `createPiFsTools(options)`                                              | `createFsTools()`: `fs` is required. Each tool's options go under `read`, `edit`, `write`, `applyPatch`, and `bash` |

- `promptSnippet` and `promptGuidelines` are Pi fields. The snippet defaults to the first sentence of the signature description, because Pi lists a tool under "Available tools" only when it has a snippet. The guidelines default to `[]`.
- Pi's `ExtensionContext` is the host type. Host functions get it as `ctx.call.host`, for example `ctx.call.host.ui.confirm(...)` in `askUser`, or `ctx.call.host.sessionManager.getSessionId()` in a `state` factory. A factory `fs`, `state`, or `runner` gets the call, so it can use `ctx.cwd`.
- The defaults are those of every integration: `digest` is `sha256Digest()`, `locks` is `memoryLocks()`, `state` is `null`, `read.converters` is `[imageConverter()]`, and the default signatures are `defaultReadSignature()`, `defaultEditSignature({ matchers })`, `defaultWriteSignature()`, `defaultPatchSignature()`, and `defaultBashSignature({ runner, limits })`. `docs/hosts.md` in `@better-fs-tools/write` has the full table.
- `createPiFsTools()` returns `read`, `edit`, `write`, `applyPatch` and `bash` (each `null` when off), `state`, `digest`, `locks`, `clock`, and `invalidate(path, call?)`. Pass the call to `invalidate` when `fs` or `state` is a factory: in a bash `afterRun` hook it is `ctx.call`.

## The Node helpers

`@better-fs-tools/pi/node` has the Node backends of a Pi extension. The main entry imports no Node module.

| Helper                         | Gives                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `piCwdFileSystem(options?)`    | A per-call `fs`: `nodeFileSystem()` with `cwd` and `allowedRoots` set to `ctx.cwd`. It keeps the filesystems of the last 8 roots. It takes every other `nodeFileSystem()` option, such as `denyRoots`, `symlinks`, `hardLinks`, `newFileMode`, and `newDirectoryMode` |
| `piCwdCommandRunner(options?)` | A per-call bash `runner`: `nodeCommandRunner()` at `ctx.cwd`, which must be absolute. It keeps the runners of the last 8 directories                                                                                                                                  |

A call without a usable `ctx.cwd` gives an `extension-failed` error result.

## Recommended configuration

These choices suit Pi. They are options, not defaults:

- `fs: piCwdFileSystem()`: each call is confined to its working directory.
- `locks: piMutationQueueLocks()`: Pi's own per-file queue, `withFileMutationQueue()`. A Better FS Tools `edit` and Pi's own `edit` or `write` on the same file then wait for each other. `piMutationQueueLocks({ timeoutMs })` waits 30 seconds by default, then fails the change with `LOCK_TIMEOUT`. In a Pi extension, Pi's loader resolves the package's import of `@earendil-works/pi-coding-agent` to Pi's own module, so the queue is Pi's. In an SDK host, install one copy of Pi, so that the package and the host share the queue.
- `digest: nodeDigest()`: the same values as `sha256Digest()`, faster on Node.
- For bash: `runner: piCwdCommandRunner()` and `env: shellEnv(() => process.env)`.

## What the tools return

- Image parts become Pi `image` parts. Other media becomes a text part that says what was left out.
- `read` gives `details.truncation` as Pi's own read tool does for line and byte stops. Its `content` comes from the formatter in `"view"` mode. For other results, or a formatter that returns parts, `details` is `{}`. `toPiReadDetails()` builds the details for your own tool.
- `edit` and `apply_patch` return `details` in the shape of Pi's `EditToolDetails` (`diff`, `patch`, `firstChangedLine`), so Pi's edit renderer draws the diff. `toPiMutationDetails()` builds them for your own tool. `write` returns no details, as Pi's own `write` does.
- A signature with a `grammar` sets `constrainedSampling` for models with grammar-tool support. For the Codex patch grammar, pass `applyPatch: { signature: freeformPatchSignature() }`. To give a model Pi's own edit input, `edits: [{ oldText, newText }]`, pass `edit: { signature: multiEditSignature() }`. Both presets come from `@better-fs-tools/write/signature`.
- A tool error becomes Pi content text with `isError: true`. The tool does not throw for a tool error. Pi shows the text as an error, and `tool_result` handlers see `isError: true`. Bad model input rejects with `TypeError`.

## Renderers

Pi draws a tool named `read`, `edit`, `write`, or `bash` with its built-in renderer of that name, unless the tool has its own. Those renderers read Pi's own argument names: `edits[].oldText` for the edit preview, and `timeout` in seconds for bash. `piToolRenderers(tools)` returns a `ToolRendererResolver` that gives each renderer the arguments in Pi's names, for any signature. Register it with `pi.registerToolRenderer()`. The extension entry does this for its own tools. Without it, the tools still work, but Pi draws no edit preview before the change and shows a bash timeout in milliseconds as seconds. A replace-all edit gets no preview, and Pi shows the diff of the result.

## Results and hints

Each tool sets these Pi 1.x tool fields:

| Tool                  | `isError`                                      | `annotations`                                                            |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `read`                | `true` for status `error`                      | `readOnlyHint: true`                                                     |
| `edit`, `apply_patch` | `true` for status `error`                      | `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: false` |
| `write`               | `true` for status `error`                      | As `edit`, with `idempotentHint: true`                                   |
| `bash`                | `true` for a nonzero exit, a timeout, an error | None                                                                     |

No tool declares an `outputSchema` or returns `structuredContent`, as in every integration. A codemode script that calls a tool gets its text. A result with `isError: true` makes the call reject with that text.

Permission extensions read `annotations` from `pi.getAllTools()`. The hints are not checked.

## Bash tool

`createPiBashTool()` is a `bash` tool from [`@better-fs-tools/shell`](https://www.npmjs.com/package/@better-fs-tools/shell) with the shared default signature, `defaultBashSignature()`: `{ command, timeout?, cwd? }` with the timeout in milliseconds. `runner` and `env` are required. With `piCwdCommandRunner()`, commands run in `ctx.cwd`, and a `cwd` from the model is relative to it. For a runner with its own directory, the `cwd` option sets another one, for example `cwd: (call) => call.host.cwd`. The extension entry does not register this tool, so Pi's own `bash` stays unless you register this one:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiBashTool, piToolRenderers } from "@better-fs-tools/pi";
import { piCwdCommandRunner } from "@better-fs-tools/pi/node";
import { shellEnv } from "@better-fs-tools/shell";

// Replaces Pi's own bash with the shared signature: { command, timeout?, cwd? },
// the timeout in milliseconds, run in ctx.cwd. Pi's bash renderer still draws it.
export default function bashExtension(pi: ExtensionAPI): void {
  const bash = createPiBashTool({
    runner: piCwdCommandRunner(), // a Node runner at ctx.cwd on each call
    env: shellEnv(() => process.env),
  });
  pi.registerTool(bash);
  pi.registerToolRenderer(piToolRenderers([bash]));
}
```

The default description names the timeouts and output limits from `limits`, and the id of a `runner` object. A runner factory, such as `piCwdCommandRunner()`, has no id to name.

Pi's own `bash` also sets `PI_*` session variables. This tool does not. Add them with the `env` option when you need them.

The bundle takes `bash` too. With a read store, a bash `afterRun` hook can make the next edit of a file need a read:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiFsTools, piToolRenderers } from "@better-fs-tools/pi";
import { piCwdCommandRunner, piCwdFileSystem } from "@better-fs-tools/pi/node";
import { memoryStore } from "@better-fs-tools/read";
import { shellEnv } from "@better-fs-tools/shell";

// The file tools with a read store, and bash in the same bundle. After each
// command, the next edit of package.json needs a read, since the command may
// have changed it.
export default function fsAndBashExtension(pi: ExtensionAPI): void {
  const tools = createPiFsTools({
    fs: piCwdFileSystem(),
    state: memoryStore(),
    bash: {
      runner: piCwdCommandRunner(),
      env: shellEnv(() => process.env),
      afterRun: [
        {
          id: "invalidate-package-json",
          afterRun: async (_outcome, ctx) => {
            // ctx.call carries Pi's ctx, so the path resolves under its cwd.
            await tools.invalidate("package.json", ctx.call);
            return {};
          },
        },
      ],
    },
  });
  pi.registerTool(tools.read);
  pi.registerTool(tools.edit);
  pi.registerTool(tools.write);
  pi.registerTool(tools.bash);
  pi.registerToolRenderer(piToolRenderers([tools.read, tools.edit, tools.write, tools.bash]));
}
```

## Pi agent core

`@better-fs-tools/pi/agent-core` gives the tools as `AgentTool` objects for `@earendil-works/pi-agent-core`: for `agent.state.tools`, or the `tools` of an `agentLoop()` context. It has `createAgentCoreFsTools()` and the single-tool factories `createAgentCoreReadTool()`, `createAgentCoreEditTool()`, `createAgentCoreWriteTool()`, `createAgentCoreApplyPatchTool()`, and `createAgentCoreBashTool()`. An `AgentTool` gets no context object, so the host type is `undefined`:

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import { createAgentCoreFsTools } from "@better-fs-tools/pi/agent-core";
import { nodeFileSystem } from "@better-fs-tools/node";
import { memoryStore } from "@better-fs-tools/read";

const fsTools = createAgentCoreFsTools({
  fs: nodeFileSystem({ cwd: "/work/repo", allowedRoots: ["/work/repo"] }),
  state: memoryStore(),
});

export function addFsTools(agent: Agent): void {
  agent.state.tools = [...agent.state.tools, ...fsTools.tools];
}
```

- The options are those of the core factories and `createFsTools()`, with the same defaults, plus a `signature` for each tool. No tool declares an output schema.
- `fs` can be any writable filesystem. The module imports no Node module and no Pi package at run time, so it runs in a browser or a Worker, for example with `memoryFileSystem()` or a Cloudflare filesystem.
- pi-agent-core has no tools of its own. `bash: { runner, env }` adds a `bash` tool with `defaultBashSignature()`: `{ command, timeout?, cwd? }` with the timeout in milliseconds.
- A tool error is a result with `isError: true`. Bad model input rejects with `TypeError`, which the agent reports as an error result.
- `read` sets `replay: "safe"`. `edit` and `apply_patch` give `toPiMutationDetails()` as `details`.
- The tools use `memoryLocks()` by default, as every integration does. pi-agent-core has no file queue of its own. Two calls in one batch that change one file wait for each other.

## Links

- [Choose an integration](https://betterfs.dev/integrations) and [Filesystems](https://betterfs.dev/filesystems) on the docs site: the defaults of every host and bundle, and what each backend can do. `docs/hosts.md` in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write) has the same tables
- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option, the default signature, `readToolDefinition()`, and the format presets. Its README has a full Pi host example.
- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): every write option, the guards, and the authorizers
- [`@better-fs-tools/node`](https://www.npmjs.com/package/@better-fs-tools/node): the filesystem and runner that the `./node` helpers build on
