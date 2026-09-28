# @better-fs-tools/pi

The Better Read tool for the [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). It replaces Pi's built-in `read` tool with a bounded reader that is confined to the working directory of each call.

## Install

```sh
npm install @better-fs-tools/pi @better-fs-tools/read @earendil-works/pi-coding-agent typebox
```

`@earendil-works/pi-coding-agent` (`^0.84.2`) and `typebox` (`^1.3.16`) are required peers. The package needs Node 24 or later.

The package has a `pi.extensions` entry. When Pi loads the package, the entry registers `read`, `edit`, `write`, and `apply_patch` from `createPiFsTools()`. The four tools share one in-memory read store, so `edit` and `write` need a read first. Writes stay inside `ctx.cwd`. The entry writes no settings or session file.

## Example

To choose your own options, register the tool from your own extension:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiReadTool } from "@better-fs-tools/pi";
import { denyPaths, unicodeRepair } from "@better-fs-tools/read";
import { hashlineFormat } from "@better-fs-tools/read/formats";
import { renamedSignature } from "@better-fs-tools/read/signature";

export default function readExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    createPiReadTool({
      signature: renamedSignature({ name: "read", names: { path: "file_path" } }),
      resolve: unicodeRepair({ note: false }),
      authorize: denyPaths(["**/.env", "**/.env.*"]),
      formatter: hashlineFormat(),
    }),
  );
}
```

## What the tool does

- `createPiReadTool(options?)` takes every `createReadTool()` option except `fs`. It also takes `signature`, `promptSnippet`, `promptGuidelines`, `denyRoots`, and `symlinks`.
- `fs`, `cwd`, and `allowedRoots` throw `TypeError`. Each call reads through `nodeFileSystem` with Pi's `ctx.cwd` as the only allowed root. When the working directory changes between calls, the root changes too. The tool keeps the filesystems for the last 8 working directories.
- Pi's `ExtensionContext` is the host type. Host functions get it as `ctx.call.host`, for example `ctx.call.host.ui.confirm(...)` in `askUser`, or `ctx.call.host.sessionManager.getSessionId()` in a `state` factory.
- The default signature is `defaultSignature({ name: "read" })`. Its schema has integer `offset` and `limit`, so a model that sends `2.5` gets Pi's validation error. `digest` defaults to `nodeDigest()`.
- Image parts become Pi `image` parts. Other media becomes a text part that says what was left out.
- `details.truncation` follows Pi's own read tool for line and byte stops. Its `content` comes from the formatter in `"view"` mode. For other results, or a formatter that returns parts, `details` is `{}`. `toPiReadDetails()` builds the details for your own tool.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option, the signature builders, and the format presets. Its README has a full Pi host example.
- [`@better-fs-tools/node`](https://www.npmjs.com/package/@better-fs-tools/node): the filesystem that each call uses
