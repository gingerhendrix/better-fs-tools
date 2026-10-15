# @better-fs-tools/pi

Better FS Tools for the [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). It replaces Pi's built-in `read`, `edit`, and `write` tools, and can add `apply_patch`. Every call is confined to the working directory of that call. A read store, so that `edit` and `write` need a read first, is opt-in.

## Install

```sh
npm install @better-fs-tools/pi @better-fs-tools/read @better-fs-tools/write @earendil-works/pi-coding-agent typebox
```

`@earendil-works/pi-coding-agent` (`^1.0.0`) and `typebox` (`^1.3.16`) are required peers. Pi versions before 1.0 are not supported. The package needs Node 24 or later.

The package has a `pi.extensions` entry. When Pi loads the package, the entry registers `read`, `edit`, and `write` from `createPiFsTools()`. They replace Pi's own tools of those names. They have the same default signatures as every Better FS Tools integration, and the entry registers `piToolRenderers()` so that Pi's built-in renderers draw them. `read` returns images. There is no read store, so `edit` and `write` do not check for a read first. Writes stay inside `ctx.cwd`. The entry writes no settings or session file.

## Example

To choose your own options, register the tools from your own extension:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiFsTools, piToolRenderers } from "@better-fs-tools/pi";
import { denyPaths, memoryStore, unicodeRepair } from "@better-fs-tools/read";
import { hashlineFormat } from "@better-fs-tools/read/formats";
import { protectPaths } from "@better-fs-tools/write";

export default function fsToolsExtension(pi: ExtensionAPI): void {
  // Four tools with one read store, so edit and write need a read first. The
  // store and apply_patch are opt-in.
  const tools = createPiFsTools({
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
import { denyPaths, unicodeRepair } from "@better-fs-tools/read";
import { hashlineFormat } from "@better-fs-tools/read/formats";
import { defaultReadSignature } from "@better-fs-tools/read/signature";

export default function readExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    createPiReadTool({
      signature: defaultReadSignature({ name: "read", names: { path: "file_path" } }),
      resolve: unicodeRepair({ note: false }),
      authorize: denyPaths(["**/.env", "**/.env.*"]),
      formatter: hashlineFormat(),
    }),
  );
}
```

## What the read tool does

- `createPiReadTool(options?)` takes every `createReadTool()` option except `fs`. It also takes `signature`, `promptSnippet`, `promptGuidelines`, `denyRoots`, and `symlinks`. `promptSnippet` and `promptGuidelines` are Pi fields. The snippet defaults to the first sentence of the signature description, because Pi lists a tool under "Available tools" only when it has a snippet. The guidelines default to `[]`.
- `fs`, `cwd`, and `allowedRoots` throw `TypeError`. Each call reads through `nodeFileSystem` with Pi's `ctx.cwd` as the only allowed root. When the working directory changes between calls, the root changes too. The tool keeps the filesystems for the last 8 working directories.
- Pi's `ExtensionContext` is the host type. Host functions get it as `ctx.call.host`, for example `ctx.call.host.ui.confirm(...)` in `askUser`, or `ctx.call.host.sessionManager.getSessionId()` in a `state` factory.
- The default signature is `defaultReadSignature()`, as in every integration. Its schema has integer `offset` and `limit`, so a model that sends `2.5` gets Pi's validation error. `digest` defaults to `nodeDigest()`, as in `createNodeFsTools()`.
- `converters` defaults to `[imageConverter()]`, as in the AI SDK integration. This holds for `createPiReadTool()`, `createPiFsTools()`, and the extension entry. A list you pass replaces the default, so `converters: []` turns images off, and a list without `imageConverter()` refuses images. In `createPiFsTools()` the option goes under `read`, for example `read: { converters: [] }`.
- Image parts become Pi `image` parts. Other media becomes a text part that says what was left out.
- `details.truncation` follows Pi's own read tool for line and byte stops. Its `content` comes from the formatter in `"view"` mode. For other results, or a formatter that returns parts, `details` is `{}`. `toPiReadDetails()` builds the details for your own tool.

## What the write tools do

- `createPiFsTools(options?)` wraps `createFsTools()` from `@better-fs-tools/write`. It builds `read`, `edit`, and `write` with one `nodeDigest()`, one lock manager, one clock, and one cache of filesystems over `ctx.cwd`. `applyPatch: true`, or an options object, adds `apply_patch`. `state` defaults to `null`, so read-before-write is off; `state: memoryStore()` turns it on. `digest` (default `nodeDigest()`), `locks`, `clock`, and the root options (`denyRoots`, `symlinks`, `hardLinks`, `newFileMode`, `newDirectoryMode`) are set once for all the tools. Each tool's other options go under `read`, `edit`, `write`, and `applyPatch`. The result also has `applyPatch` (`null` when off), `state`, `digest`, `locks`, `clock`, and `invalidate(path, call?)`, which returns an `InvalidateOutcome`. Pass the call, so the path resolves under its `ctx.cwd`: in a bash `afterRun` hook it is `ctx.call`. Without it the outcome is `{ ok: false }` with reason `unsupported`. An unknown top-level key, or `state`, `digest`, `locks`, `clock`, or a root option inside a tool's options, throws `TypeError`.
- `createPiEditTool()`, `createPiWriteTool()`, and `createPiApplyPatchTool()` build one tool each. They default to `state: null`, so read-before-write is off. Pass the same `state` as your read tool, or use `createPiFsTools()`.
- `fs`, `cwd`, and `allowedRoots` throw `TypeError`, as for the read tool. Writes go through `nodeFileSystem` with `ctx.cwd` as the only allowed root, and `hardLinks: "in-place"` by default: a file with more than one hard link is written through the link, not atomically. `hardLinks: "refuse"` fails that write with `DENIED`. `newFileMode` and `newDirectoryMode` set the modes of new files and directories exactly. Without them, a new file is `0o666` and a new directory `0o777`, less the process umask.
- The default signatures are the shared defaults of every integration: `edit` takes `path`, `old_string`, `new_string`, and `replace_all` (`defaultEditSignature()`), `write` takes `path` and `content` (`defaultWriteSignature()`), and `apply_patch` takes one `patch` string (`defaultPatchSignature()`). The prompt snippet is the first sentence of the signature description, and there are no guidelines. To give a model Pi's own edit input, pass `edit: { signature: multiEditSignature() }`. For the Codex patch grammar on models with grammar-tool support, pass `applyPatch: { signature: freeformPatchSignature() }`. Both presets come from `@better-fs-tools/write/signature`.
- `edit` and `apply_patch` return `details` in the shape of Pi's `EditToolDetails` (`diff`, `patch`, `firstChangedLine`), so Pi's edit renderer draws the diff. `toPiMutationDetails()` builds them for your own tool. `write` returns no details, as Pi's own `write` does.
- `locks` defaults to `piMutationQueueLocks()` in `createPiFsTools()` and in each single-tool factory. It takes Pi's own per-file queue, `withFileMutationQueue()`, so a Better FS Tools `edit` and Pi's own `edit` or `write` on the same file wait for each other. Pass `locks: memoryLocks()` for the old behaviour. `piMutationQueueLocks({ timeoutMs })` waits 30 seconds by default, then fails the change with `LOCK_TIMEOUT`. In a Pi extension, Pi's loader resolves the package's import of `@earendil-works/pi-coding-agent` to Pi's own module, so the queue is Pi's. In an SDK host, install one copy of Pi, so that the package and the host share the queue.
- A tool error becomes Pi content text with `isError: true`. The tool does not throw for a tool error. Pi shows the text as an error, and `tool_result` handlers see `isError: true`.
- The tool also accepts close matches for the old text, and the result says when it used one.

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

`createPiBashTool()` is a `bash` tool from [`@better-fs-tools/shell`](https://www.npmjs.com/package/@better-fs-tools/shell) with the shared default signature, `defaultBashSignature()`: `{ command, timeout?, cwd? }` with the timeout in milliseconds. A `cwd` from the model is relative to `ctx.cwd`. Commands run in `ctx.cwd` by default, also with a `runner` you pass: the runner gets `ctx.cwd` as the request's `cwd`, not its own. A relative `ctx.cwd` throws `TypeError`. For Pi's own bash input, pass `signature: defaultBashSignature({ timeoutUnit: "s", cwd: false })`. The extension entry does not register this tool, so Pi's own `bash` stays unless you register this one:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiBashTool, piToolRenderers } from "@better-fs-tools/pi";

// Replaces Pi's own bash with the shared signature: { command, timeout?, cwd? },
// the timeout in milliseconds, run in ctx.cwd. Pi's bash renderer still draws it.
export default function bashExtension(pi: ExtensionAPI): void {
  const bash = createPiBashTool();
  pi.registerTool(bash);
  pi.registerToolRenderer(piToolRenderers([bash]));
}
```

The options take every `createBashTool()` dependency except `cwd`, plus `runner`, `signature`, `promptSnippet`, and `promptGuidelines`. `runner` and `env` are optional here. The default description names the timeouts and output limits from `limits`, and the id of a `runner` object when you pass one.

Pi's own `bash` also sets `PI_*` session variables. This tool does not. Add them with the `env` option when you need them. `env` defaults to `shellEnv(() => process.env)`.

With the file tools, a bash `afterRun` hook can make the next edit of a file need a read:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiBashTool, createPiFsTools, piToolRenderers } from "@better-fs-tools/pi";
import { memoryStore } from "@better-fs-tools/read";

// The file tools with a read store, and bash. After each command,
// the next edit of package.json needs a read, since the command may have
// changed it.
export default function fsAndBashExtension(pi: ExtensionAPI): void {
  const tools = createPiFsTools({ state: memoryStore() });
  const bash = createPiBashTool({
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
  });
  pi.registerTool(tools.read);
  pi.registerTool(tools.edit);
  pi.registerTool(tools.write);
  pi.registerTool(bash);
  pi.registerToolRenderer(piToolRenderers([tools.read, tools.edit, tools.write, bash]));
}
```

## Pi agent core

`@better-fs-tools/pi/agent-core` has `createAgentCoreFsTools()`. It gives the tools as `AgentTool` objects for `@earendil-works/pi-agent-core`: for `agent.state.tools`, or the `tools` of an `agentLoop()` context. An `AgentTool` gets no context object, so the bundle takes a filesystem, as `createFsTools()` does:

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

- The options are those of `createFsTools()`: `fs` (required), `state`, `digest`, `locks`, `clock`, `read`, `edit`, `write`, `applyPatch`, and `bash`. Each tool's options also take a `signature`. The default signatures are the shared defaults of every integration. No tool declares an output schema.
- `fs` can be any writable filesystem. The module imports no Node module and no Pi package at run time, so it runs in a browser or a Worker, for example with `memoryFileSystem()` or a Cloudflare filesystem.
- pi-agent-core has no tools of its own. `bash: { runner, env }` adds a `bash` tool with `defaultBashSignature()`: `{ command, timeout?, cwd? }` with the timeout in milliseconds.
- A tool error is a result with `isError: true`. Bad model input throws `TypeError`, which the agent reports as an error result.
- `read` sets `replay: "safe"`. `edit` and `apply_patch` give `toPiMutationDetails()` as `details`.
- The tools use `memoryLocks()` by default. pi-agent-core has no file queue of its own. Two calls in one batch that change one file wait for each other.

## Links

- `docs/hosts.md` in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the defaults of every host and bundle, and what each backend can do
- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option, the signature builders, and the format presets. Its README has a full Pi host example.
- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): every write option, the guards, and the authorizers
- [`@better-fs-tools/node`](https://www.npmjs.com/package/@better-fs-tools/node): the filesystem that each call uses
