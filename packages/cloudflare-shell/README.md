# @better-fs-tools/cloudflare-shell

A `WritableFileSystem` over a [Cloudflare Shell](https://www.npmjs.com/package/@cloudflare/shell) `Workspace`, for the Better Read tool and the `edit`, `write`, and `apply_patch` tools in a Worker or a Cloudflare Agent.

## Install

```sh
npm install @better-fs-tools/cloudflare-shell @better-fs-tools/read @better-fs-tools/write
```

The package has no peers. It declares the Workspace methods that it uses as a structural type, so `@cloudflare/shell`'s `Workspace` fits without an import. It imports no `node:` module.

## Example

With the AI SDK adapter (`npm install @better-fs-tools/ai-sdk ai`):

```ts
import type { Workspace } from "@cloudflare/shell";
import { createAiSdkReadTool } from "@better-fs-tools/ai-sdk";
import { cloudflareShellFileSystem } from "@better-fs-tools/cloudflare-shell";

export function workspaceReadTool(workspace: Workspace) {
  return createAiSdkReadTool({
    fs: cloudflareShellFileSystem(workspace, { allowedRoots: ["/workspace"] }),
  });
}
```

With the write tools. `createAiSdkFsTools()` gives the read tool and the write tools one store, one digest, and one lock manager. Its default digest, `sha256Digest()` from `@better-fs-tools/read`, is SHA-256 in plain JavaScript, so it runs in a Worker:

```ts
import type { Workspace } from "@cloudflare/shell";
import { createAiSdkFsTools } from "@better-fs-tools/ai-sdk";
import { cloudflareShellFileSystem } from "@better-fs-tools/cloudflare-shell";

// read, edit, write, and apply_patch with one store, one sha256Digest(), and
// one lock manager. Nothing here needs Node, so it runs in a Worker.
export function workspaceTools(workspace: Workspace) {
  const fs = cloudflareShellFileSystem(workspace, { allowedRoots: ["/workspace"] });
  return createAiSdkFsTools({ fs }).tools;
}
```

## What the filesystem does

- `cloudflareShellFileSystem(workspace, options)` takes the shared `FileSystemRootOptions` and `maxBufferedBytes` from `@better-fs-tools/fs`: `allowedRoots` (required), `denyRoots`, `cwd`, `id`, `symlinks`, and `identity`. It refuses every path outside the allowed roots, or inside a deny root, before it calls the Workspace. A deny root gives `dangerous-path`, as in every adapter.
- `cwd` must be absolute and defaults to the first allowed root. Relative paths and relative roots resolve against it. Display paths are relative to `cwd`, and absolute outside it. `id` defaults to `"cloudflare-shell"`.
- `symlinks` can only be `"reject"` and `identity` only `"none"`. It walks each path with `lstat` from `/`, so a symlink above the root, a symlinked root, parent, or file is refused before any byte is read.
- The filesystem exposes the resolved `cwd`, `allowedRoots`, `denyRoots`, `symlinks`, `identity`, and `maxBufferedBytes`.
- Reads are buffered: the Workspace returns whole files. `maxBufferedBytes` defaults to 16 MiB, as in every buffering adapter. When you use converters, set it at or above `maxConvertBytes` and `maxMediaBytes`.
- Because reads are buffered inside `open()`, the whole file has left the Workspace before the read tool's `authorize` runs. The core still passes no byte to a classifier, a converter, or the model until `authorize` allows it. If a denied read must not reach the Workspace, deny it in the adapter with `denyRoots` or `allowedRoots`.
- `verify()` compares size and modification time. A same-size edit within the same millisecond is not detected.
- `list()` lists directories, so suggestions and `directoryListing()` work. Opening a directory gives a `not-a-file` error with `kind: "directory"`.

## How it writes

- `stat()`, `write()`, and `remove()` use `lstat`, `writeFileBytes`, `mkdir`, and `rm`. They check the roots and refuse every symlink on the path before any Workspace write, as `open()` does. `writeFileBytes` would create missing parents and follow a link by itself, so the adapter checks both first.
- `writeFileBytes`, `mkdir`, and `rm` are optional in `CloudflareShellWorkspaceLike`. They are checked when a write runs, not when the filesystem is built. A read-only Workspace wrapper backs the read tool, and a write to it gives `unsupported`, which the tools report as `UNSUPPORTED_BACKEND`.
- `writeCapabilities` is `{ compareAndSwap: false }`. A large file spills to R2 in several steps, so a reader can see a partial file. Shell has no version check, so the adapter checks the precondition with a fresh `lstat` just before the write. Shell has no modes.
- There is no `stage()`: Shell's `mv` removes the destination first. `apply_patch` writes each file in turn, and undoes them on a failure.
- The version is the size and `updatedAt`. Shell stores whole seconds, so two same-size writes in one second keep the version. The write tools also compare the content hash of what the model read, so a change after the read is still `STALE`. Between the adapter's last check and the write, it is not seen.
- A replace passes the file's mime type back, since Shell would reset it. A new file gets Shell's default, `application/octet-stream`.
- A read or a write over `maxBufferedBytes` gives `too-large` with the `limit` and the `size`, since the adapter could not read the file back. The tools report `TOO_LARGE`. The effective limit is the smaller of `maxBufferedBytes` and the tool's own limits.
- Shell's errors carry their POSIX code in the message. The adapter reads the code and drops the message: `EEXIST` gives `exists`, `EROFS` gives `read-only`, and `ENOSPC` and `EDQUOT` give `no-space`.

## Links

- `docs/hosts.md` in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the defaults of every host and bundle, and what each backend can do
- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the write tools
- [`@better-fs-tools/ai-sdk`](https://www.npmjs.com/package/@better-fs-tools/ai-sdk): the AI SDK tools
- [`@better-fs-tools/fs`](https://www.npmjs.com/package/@better-fs-tools/fs): the filesystem contract
