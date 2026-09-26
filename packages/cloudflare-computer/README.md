# @better-fs-tools/cloudflare-computer

A read-only `FileSystem` over a [Cloudflare Computer](https://www.npmjs.com/package/@cloudflare/computer) workspace filesystem, for the Better Read tool.

This package is experimental. Cloudflare Computer is preview software, and this adapter follows the `@cloudflare/computer` 0.2.1 declarations.

## Install

```sh
npm install @better-fs-tools/cloudflare-computer @better-fs-tools/read
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

## What the filesystem does

- `computerFileSystem(workspace.fs, { root, id? })` refuses every path outside `root` before it calls the workspace.
- It walks each path with `lstat`, so symlinks are refused before any byte is read.
- It streams the file that `readFile` returns.
- `verify()` compares size and modification time, so results have a `weak-identity` note.
- `list()` lists directories, so suggestions and `directoryListing()` work.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/fs`](https://www.npmjs.com/package/@better-fs-tools/fs): the filesystem contract
