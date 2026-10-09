# @better-fs-tools/pi

Better FS Tools for the [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). It replaces Pi's built-in `read`, `edit`, and `write` tools, and can add `apply_patch`. Every call is confined to the working directory of that call. A read store, so that `edit` and `write` need a read first, is opt-in.

## Install

```sh
npm install @better-fs-tools/pi @better-fs-tools/read @better-fs-tools/write @earendil-works/pi-coding-agent typebox
```

`@earendil-works/pi-coding-agent` (`^0.84.2`) and `typebox` (`^1.3.16`) are required peers. The package needs Node 24 or later.

The package has a `pi.extensions` entry. When Pi loads the package, the entry registers `read`, `edit`, and `write` from `createPiFsTools()`, as Pi's own tools are. There is no read store, so `edit` and `write` do not check for a read first. Writes stay inside `ctx.cwd`. The entry writes no settings or session file.

## Example

To choose your own options, register the tools from your own extension:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiFsTools } from "@better-fs-tools/pi";
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

- `createPiReadTool(options?)` takes every `createReadTool()` option except `fs`. It also takes `signature`, `promptSnippet`, `promptGuidelines`, `denyRoots`, and `symlinks`.
- `fs`, `cwd`, and `allowedRoots` throw `TypeError`. Each call reads through `nodeFileSystem` with Pi's `ctx.cwd` as the only allowed root. When the working directory changes between calls, the root changes too. The tool keeps the filesystems for the last 8 working directories.
- Pi's `ExtensionContext` is the host type. Host functions get it as `ctx.call.host`, for example `ctx.call.host.ui.confirm(...)` in `askUser`, or `ctx.call.host.sessionManager.getSessionId()` in a `state` factory.
- The default signature is `defaultReadSignature({ name: "read" })`. Its schema has integer `offset` and `limit`, so a model that sends `2.5` gets Pi's validation error. `digest` defaults to `nodeDigest()`.
- Image parts become Pi `image` parts. Other media becomes a text part that says what was left out.
- `details.truncation` follows Pi's own read tool for line and byte stops. Its `content` comes from the formatter in `"view"` mode. For other results, or a formatter that returns parts, `details` is `{}`. `toPiReadDetails()` builds the details for your own tool.

## What the write tools do

- `createPiFsTools(options?)` wraps `createFsTools()` from `@better-fs-tools/write`. It builds `read`, `edit`, and `write` with one `nodeDigest()`, one lock manager, one clock, and one cache of filesystems over `ctx.cwd`. `applyPatch: true`, or an options object, adds `apply_patch`. `state` defaults to `null`, so read-before-write is off; `state: memoryStore()` turns it on. `digest` (default `nodeDigest()`), `locks`, `clock`, and the root options (`denyRoots`, `symlinks`, `hardLinks`, `newFileMode`, `newDirectoryMode`) are set once for all the tools. Each tool's other options go under `read`, `edit`, `write`, and `applyPatch`. The result also has `applyPatch` (`null` when off), `state`, `digest`, `locks`, `clock`, and `invalidate(path, call?)`, which returns an `InvalidateOutcome`. Pass the call, so the path resolves under its `ctx.cwd`: in a bash `afterRun` hook it is `ctx.call`. Without it the outcome is `{ ok: false }` with reason `unsupported`. An unknown top-level key, or `state`, `digest`, `locks`, `clock`, or a root option inside a tool's options, throws `TypeError`.
- `createPiEditTool()`, `createPiWriteTool()`, and `createPiApplyPatchTool()` build one tool each. They default to `state: null`, so read-before-write is off. Pass the same `state` as your read tool, or use `createPiFsTools()`.
- `fs`, `cwd`, and `allowedRoots` throw `TypeError`, as for the read tool. Writes go through `nodeFileSystem` with `ctx.cwd` as the only allowed root, and `hardLinks: "in-place"` by default: a file with more than one hard link is written through the link, not atomically. `hardLinks: "refuse"` fails that write with `DENIED`. `newFileMode` and `newDirectoryMode` set the modes of new files and directories exactly. Without them, a new file is `0o666` and a new directory `0o777`, less the process umask.
- The default signatures follow Pi's own tools: `edit` takes `path` and `edits: [{ oldText, newText }]` (`multiEditSignature({ name: "edit" })`), and `write` takes `path` and `content`. Their prompt snippets and guidelines are Pi's own, so the system prompt stays the same. `apply_patch` uses `freeformPatchSignature()`: models with grammar-tool support get the Codex patch grammar, and other models get the JSON schema.
- `edit` and `apply_patch` return `details` in the shape of Pi's `EditToolDetails` (`diff`, `patch`, `firstChangedLine`), so Pi's edit renderer draws the diff. `toPiMutationDetails()` builds them for your own tool. `write` returns no details, as Pi's own `write` does.
- A tool error becomes Pi content text. The tool does not throw for a tool error.
- Pi's `edit` guideline says the old text must match exactly. The tool also accepts close matches, and the result says when it used one.

## Bash tool

`createPiBashTool()` is a `bash` tool from [`@better-fs-tools/shell`](https://www.npmjs.com/package/@better-fs-tools/shell) with Pi's own shape: `{ command, timeout }` with the timeout in seconds, and Pi's prompt snippet. It runs in `ctx.cwd` on every call, also with a `runner` you pass: the runner gets `ctx.cwd` as the request's `cwd`, not its own. A relative `ctx.cwd` throws `TypeError`. The extension entry does not register it, so Pi's own `bash` stays unless you register this one:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiBashTool } from "@better-fs-tools/pi";

// Replaces Pi's own bash: same name, { command, timeout } in seconds, run in ctx.cwd.
export default function bashExtension(pi: ExtensionAPI): void {
  pi.registerTool(createPiBashTool());
}
```

The options take every `createBashTool()` dependency except `cwd`, plus `runner`, `signature`, `promptSnippet`, and `promptGuidelines`. `runner` and `env` are optional here. The default description names the timeouts and output limits from `limits`, and the id of a `runner` object when you pass one.

Pi's own `bash` also sets `PI_*` session variables. This tool does not. Add them with the `env` option when you need them. `env` defaults to `shellEnv(() => process.env)`.

With the file tools, a bash `afterRun` hook can make the next edit of a file need a read:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiBashTool, createPiFsTools } from "@better-fs-tools/pi";
import { memoryStore } from "@better-fs-tools/read";

// The file tools with a read store, and Pi-shaped bash. After each command,
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
}
```

## Links

- `docs/hosts.md` in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the defaults of every host and bundle, and what each backend can do
- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option, the signature builders, and the format presets. Its README has a full Pi host example.
- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): every write option, the guards, and the authorizers
- [`@better-fs-tools/node`](https://www.npmjs.com/package/@better-fs-tools/node): the filesystem that each call uses
