# @better-fs-tools/just-bash

A `FileSystem` and a `WritableFileSystem` over a [just-bash](https://www.npmjs.com/package/just-bash) `IFileSystem`, for the Better Read tool and the `edit`, `write`, and `apply_patch` tools in a just-bash sandbox.

## Install

```sh
npm install @better-fs-tools/just-bash @better-fs-tools/read @better-fs-tools/write just-bash
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

`justBashFileSystem()` takes the same options and adds writes:

```ts
import { InMemoryFs } from "just-bash";
import { justBashFileSystem } from "@better-fs-tools/just-bash";
import { nodeDigest } from "@better-fs-tools/node";
import { createMemoryStore, createReadTool, textOf } from "@better-fs-tools/read";
import { createEditTool, memoryLocks } from "@better-fs-tools/write";

const bash = new InMemoryFs({ "/workspace/src/index.ts": "const a = 1;\n" });
const fs = justBashFileSystem(bash, {
  id: "sandbox",
  cwd: "/workspace",
  allowedRoots: ["/workspace"],
  maxBufferedBytes: 4 * 1024 * 1024,
});
const shared = { fs, state: createMemoryStore(), digest: nodeDigest() };
const read = createReadTool(shared);
const edit = createEditTool({ ...shared, locks: memoryLocks() });

await read({ path: "src/index.ts" });
console.log(textOf(await edit({ path: "src/index.ts", edits: [{ oldText: "1", newText: "2" }] })));
// Edited src/index.ts: 1 replacement at line 1.
// 1|const a = 2;
//
// [edit:not-atomic] The sandbox backend does not replace files atomically, ...
// [edit:no-compare-and-swap] The sandbox backend cannot check the file version ...
console.log(await bash.readFile("/workspace/src/index.ts")); // const a = 2;
```

## What the filesystem does

- `justBashReadFileSystem(fs, options)` checks each path against `allowedRoots` and `denyRoots` before it touches the backend, and again after `realpath()`.
- `id` and `maxBufferedBytes` are required. `just-bash` returns whole buffers, so reads are buffered and results have a `buffered-backend` note.
- `identity` defaults to `"none"`: change detection compares size and modification time, and results have a `weak-identity` note. With `identity: "required"`, the backend's `stat()` must give an identity or a device and inode for every file. A file without one is refused as `UNSUPPORTED_BACKEND`.
- `symlinks` defaults to `"reject"`, which refuses a final symlink. `"backend-policy"` leaves symlinks to the backend.
- Backend errors are reduced to a POSIX code and a phase. Raw messages, which can contain paths, are not passed on.
- `list()` lists directories, so suggestions and `directoryListing()` work.

## How it writes

`justBashFileSystem(fs, options)` is the read adapter plus `stat()`, `write()`, and `remove()`. `justBashReadFileSystem()` stays read-only. The backend must have `writeFile`, `mkdir`, `rm`, `chmod`, and `utimes`.

- Writes apply the same roots, deny roots, and symlink policy as `open()`. Under `"reject"`, a final symlink is refused. Under `"backend-policy"`, a link inside the roots is followed to its real path and the link stays. A link out of the roots and a dangling link are refused.
- `writeCapabilities` is `{ atomic: false, compareAndSwap: false, preserveMode: true }`. A write is `writeFile` and then `chmod`, and `IFileSystem` has no version check, so the adapter checks the precondition with a fresh stat just before the write. The write tools add a `not-atomic` and a `no-compare-and-swap` note.
- `InMemoryFs` resets the mode to `0o644` on every write, so a replace calls `chmod` with the old mode.
- `InMemoryFs` keeps `mtime` when two writes fall in one millisecond. When a replace leaves `mtime` where it was, the adapter moves it on by one millisecond with `utimes`, so every write through the adapter changes the version.
- `identity: "required"` makes the write tools trust the version, which is the identity, size, and `mtime`. Another writer that changes a file to the same size inside the same millisecond is then not seen. With the default, `identity: "none"`, the write tools also compare the content hash of what the model read.
- There is no `stage()`. `apply_patch` writes each file in turn, and undoes them on a failure.
- `EEXIST` gives `exists`, `EROFS` gives `read-only`, and `ENOSPC` gives `no-space`.

## Bash runner

`justBashCommandRunner(bash)` runs the `bash` tool from [`@better-fs-tools/shell`](https://www.npmjs.com/package/@better-fs-tools/shell) in a just-bash `Bash`. Nothing starts a process. stdin is empty, the tool's environment replaces the shell's own, and the cwd is set for the call only.

```ts
import { Bash } from "just-bash";
import { justBashCommandRunner } from "@better-fs-tools/just-bash";
import { createBashTool, textOf } from "@better-fs-tools/shell";

// An emulated shell over an in-memory filesystem. Nothing starts a process.
// executionLimits stop a busy loop, because no timer fires while one runs.
const shell = new Bash({
  files: { "/workspace/notes.txt": "one\ntwo\n" },
  cwd: "/workspace",
  executionLimits: { maxCommandCount: 100_000 },
});

const bash = createBashTool({ runner: justBashCommandRunner(shell) });

console.log(textOf(await bash({ command: "wc -l notes.txt" })));
// Exit code 0 · 0 s
// 2 notes.txt
```

just-bash buffers output, so stdout arrives whole before stderr, after the command ends. A stop aborts at the next statement boundary. A busy loop does not yield to the event loop, so no timer fires while it runs: set `executionLimits` as the backstop. Under Bun, just-bash 3.4.2 cannot apply its defense-in-depth patches and throws on `exec()`. Pass `defenseInDepth: false` there. Node runs the default.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the write tools
- [`@better-fs-tools/fs`](https://www.npmjs.com/package/@better-fs-tools/fs): the filesystem contract
