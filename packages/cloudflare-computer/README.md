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
import { computerFileSystem } from "@better-fs-tools/cloudflare-computer";
import { createReadTool } from "@better-fs-tools/read";

export function computerReadTool(workspace: Workspace) {
  return createReadTool({ fs: computerFileSystem(workspace.fs, { root: "/workspace" }) });
}
```

With the write tools, which share one store and one digest with the read tool:

```ts
import type { Workspace } from "@cloudflare/computer";
import { computerFileSystem } from "@better-fs-tools/cloudflare-computer";
import { createReadTool } from "@better-fs-tools/read";
import type { Digest } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";
import { createEditTool, createWriteTool, memoryLocks } from "@better-fs-tools/write";

// A Digest is synchronous, and a Worker has no node:crypto: pass a pure JavaScript hash.
export function computerTools(workspace: Workspace, digest: Digest) {
  const fs = computerFileSystem(workspace.fs, { root: "/workspace" });
  const shared = { fs, state: createMemoryStore(), digest };
  const locks = memoryLocks();
  return {
    read: createReadTool(shared),
    edit: createEditTool({ ...shared, locks }),
    write: createWriteTool({ ...shared, locks }),
  };
}
```

## What the filesystem does

- `computerFileSystem(workspace.fs, { root, id? })` refuses every path outside `root` before it calls the workspace.
- It walks each path with `lstat`, so symlinks are refused before any byte is read.
- It streams the file that `readFile` returns.
- `verify()` compares size and modification time, so results have a `weak-identity` note.
- `list()` lists directories, so suggestions and `directoryListing()` work.

## How it writes

- `stat()`, `write()`, and `remove()` use `lstat`, `writeFile`, `mkdir`, and `rm`. They check the root and refuse every symlink on the path before any write, as `open()` does.
- `writeCapabilities` is `{ atomic: true, compareAndSwap: false, preserveMode: true }`. `writeFile` runs in one transaction. It has no version check, so the adapter checks the precondition with a fresh `lstat` just before the write, and the write tools add a `no-compare-and-swap` note. A create passes `exclusive: true`, so two creators cannot both win.
- `writeFile` sets the mode to `0o644` unless it gets one, also on a replace. The adapter passes the mode that `lstat` reported, so a replace keeps it. `stat()` reports the mode.
- There is no `stage()`: Computer has no rename. `apply_patch` writes each file in turn, and undoes them on a failure.
- The version is the size and the modification time in milliseconds. The write tools also compare the content hash of what the model read, so a same-size change after the read is still `STALE`.
- `EEXIST` gives `exists`, `EROFS` gives `read-only`, and `ENOSPC` gives `no-space`.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the write tools
- [`@better-fs-tools/fs`](https://www.npmjs.com/package/@better-fs-tools/fs): the filesystem contract
