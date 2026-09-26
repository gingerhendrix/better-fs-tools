# @better-fs-tools/cloudflare-shell

A read-only `FileSystem` over a [Cloudflare Shell](https://www.npmjs.com/package/@cloudflare/shell) `Workspace`, for the Better Read tool in a Worker or a Cloudflare Agent.

## Install

```sh
npm install @better-fs-tools/cloudflare-shell @better-fs-tools/read
```

The package has no peers. It declares the Workspace methods that it uses as a structural type, so `@cloudflare/shell`'s `Workspace` fits without an import. It imports no `node:` module.

## Example

With the AI SDK adapter (`npm install @better-fs-tools/ai-sdk ai`):

```ts
import type { Workspace } from "@cloudflare/shell";
import { createAiSdkReadTool } from "@better-fs-tools/ai-sdk";
import { shellWorkspaceFileSystem } from "@better-fs-tools/cloudflare-shell";

export function workspaceReadTool(workspace: Workspace) {
  return createAiSdkReadTool({
    fs: shellWorkspaceFileSystem(workspace, { root: "/workspace" }),
  });
}
```

## What the filesystem does

- `shellWorkspaceFileSystem(workspace, { root, maxBufferedBytes?, id? })` refuses every path outside `root` before it calls the Workspace.
- It walks each path with `lstat`, so a symlinked root, parent, or file is refused before any byte is read.
- Reads are buffered: the Workspace returns whole files. `maxBufferedBytes` defaults to 4 MiB. When you use converters, set it at or above `maxConvertBytes` and `maxMediaBytes`. Results have a `buffered-backend` note.
- `verify()` compares size and modification time. A same-size edit within the same millisecond is not detected. Results have a `weak-identity` note.
- `list()` lists directories, so suggestions and `directoryListing()` work. Opening a directory gives a `not-a-file` error with `kind: "directory"`.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/ai-sdk`](https://www.npmjs.com/package/@better-fs-tools/ai-sdk): the AI SDK tool
- [`@better-fs-tools/fs`](https://www.npmjs.com/package/@better-fs-tools/fs): the filesystem contract
