# @better-fs-tools/just-bash

A read-only `FileSystem` over a [just-bash](https://www.npmjs.com/package/just-bash) `IFileSystem`, for the Better Read tool in a just-bash sandbox.

## Install

```sh
npm install @better-fs-tools/just-bash @better-fs-tools/read just-bash
```

`just-bash` is a required peer, pinned to `3.4.2`.

## Example

```ts
import { InMemoryFs } from "just-bash";
import { justBashReadFileSystem } from "@better-fs-tools/just-bash";
import { createReadTool, textOf } from "@better-fs-tools/read";

const bash = new InMemoryFs({ "/workspace/src/index.ts": "const a = 1;\n" });

const read = createReadTool({
  fs: justBashReadFileSystem(bash, {
    id: "sandbox",
    cwd: "/workspace",
    allowedRoots: ["/workspace"],
    maxBufferedBytes: 4 * 1024 * 1024,
  }),
});

console.log(textOf(await read({ path: "src/index.ts" })));
// 1|const a = 1;
//
// [read:weak-identity] The sandbox backend has no stable identity, ...
// [read:buffered-backend] The sandbox backend buffers whole objects instead of streaming them.
```

## What the filesystem does

- `justBashReadFileSystem(fs, options)` checks each path against `allowedRoots` and `denyRoots` before it touches the backend, and again after `realpath()`.
- `id` and `maxBufferedBytes` are required. `just-bash` returns whole buffers, so reads are buffered and results have a `buffered-backend` note.
- `identity` defaults to `"none"`: change detection compares size and modification time, and results have a `weak-identity` note. With `identity: "required"`, the backend's `stat()` must give an identity or a device and inode for every file. A file without one is refused as `UNSUPPORTED_BACKEND`.
- `symlinks` defaults to `"reject"`, which refuses a final symlink. `"backend-policy"` leaves symlinks to the backend.
- Backend errors are reduced to a POSIX code and a phase. Raw messages, which can contain paths, are not passed on.
- `list()` lists directories, so suggestions and `directoryListing()` work.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/fs`](https://www.npmjs.com/package/@better-fs-tools/fs): the filesystem contract
