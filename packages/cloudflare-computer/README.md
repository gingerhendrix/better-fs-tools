# @better-fs-tools/cloudflare-computer

A `WritableFileSystem` over a [Cloudflare Computer](https://www.npmjs.com/package/@cloudflare/computer) workspace filesystem, for the Better Read tool and the `edit`, `write`, and `apply_patch` tools.

This package is experimental. Cloudflare Computer is preview software, and this adapter follows the `@cloudflare/computer` 0.2.1 declarations.

## Install

```sh
npm install @better-fs-tools/cloudflare-computer @better-fs-tools/read @better-fs-tools/write
```

The package has no peers. It declares the filesystem methods that it uses as a structural type, so `Workspace["fs"]` and `WorkspaceFilesystemStub` from `@cloudflare/computer` 0.2.1 fit without an import. It imports no `node:` module.

## Example

```ts
import type { Workspace } from "@cloudflare/computer";
import { cloudflareComputerFileSystem } from "@better-fs-tools/cloudflare-computer";
import { createReadTool } from "@better-fs-tools/read";

export function computerReadTool(workspace: Workspace) {
  return createReadTool({
    fs: cloudflareComputerFileSystem(workspace.fs, { allowedRoots: ["/workspace"] }),
  });
}
```

With the write tools. `createFsTools()` from `@better-fs-tools/write` gives them and the read tool one store, one digest, and one lock manager. Its default digest, `sha256Digest()`, is plain JavaScript, so it runs in a Worker:

```ts
import type { Workspace } from "@cloudflare/computer";
import { cloudflareComputerFileSystem } from "@better-fs-tools/cloudflare-computer";
import { createFsTools } from "@better-fs-tools/write";

// One store, one sha256Digest(), and one lock manager. createFsTools needs no
// Node module, so it runs in a Worker.
export function computerTools(workspace: Workspace) {
  const fs = cloudflareComputerFileSystem(workspace.fs, { allowedRoots: ["/workspace"] });
  const { read, edit, write } = createFsTools({ fs });
  return { read, edit, write };
}
```

## What the filesystem does

- `cloudflareComputerFileSystem(workspace.fs, options)` takes the shared `FileSystemRootOptions` from `@better-fs-tools/fs`: `allowedRoots` (required), `denyRoots`, `cwd`, `id`, `symlinks`, and `identity`. It refuses every path outside the allowed roots, or inside a deny root, before it calls the workspace. A deny root gives `dangerous-path`, as in every adapter.
- `cwd` must be absolute and defaults to the first allowed root. Relative paths and relative roots resolve against it. Display paths are relative to `cwd`, and absolute outside it. `id` defaults to `"cloudflare-computer"`. `symlinks` can only be `"reject"` and `identity` only `"none"`. Reads stream, so there is no `maxBufferedBytes`.
- The filesystem exposes the resolved `cwd`, `allowedRoots`, `denyRoots`, `symlinks`, and `identity`.
- It walks each path with `lstat`, so symlinks are refused before any byte is read.
- It streams the file that `readFile` returns. `open()` starts the `readFile` stream, so the request reaches the backend before the read tool's `authorize` runs, but no chunk is read until `authorize` allows it. If a denied read must not reach the backend, deny it in the adapter with `denyRoots` or `allowedRoots`.
- `verify()` compares size and modification time, so results have a `weak-identity` note.
- `list()` lists directories, so suggestions and `directoryListing()` work.

## How it writes

- `stat()`, `write()`, and `remove()` use `lstat`, `writeFile`, `mkdir`, and `rm`. They check the roots and refuse every symlink on the path before any write, as `open()` does.
- `writeFile`, `mkdir`, and `rm` are optional in `CloudflareComputerFileSystemLike`. They are checked when a write runs, not when the filesystem is built. A read-only wrapper backs the read tool, and a write to it gives `unsupported`, which the tools report as `UNSUPPORTED_BACKEND`.
- `writeCapabilities` is `{ atomic: true, compareAndSwap: false, preserveMode: true }`. `writeFile` runs in one transaction. It has no version check, so the adapter checks the precondition with a fresh `lstat` just before the write, and the write tools add a `no-compare-and-swap` note. A create passes `exclusive: true`, so two creators cannot both win.
- `writeFile` sets the mode to `0o644` unless it gets one, also on a replace. The adapter passes the mode that `lstat` reported, so a replace keeps it. `stat()` reports the mode.
- There is no `stage()`: Computer has no rename. `apply_patch` writes each file in turn, and undoes them on a failure.
- The version is the size and the modification time in milliseconds. The write tools also compare the content hash of what the model read, so a same-size change after the read is still `STALE`.
- `EEXIST` gives `exists`, `EROFS` gives `read-only`, and `ENOSPC` and `EDQUOT` give `no-space`.

## Links

- `docs/hosts.md` in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the defaults of every host and bundle, and what each backend can do
- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the write tools
- [`@better-fs-tools/fs`](https://www.npmjs.com/package/@better-fs-tools/fs): the filesystem contract
