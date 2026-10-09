# @better-fs-tools/just-bash

A `WritableFileSystem` over a [just-bash](https://www.npmjs.com/package/just-bash) `IFileSystem`, for the Better Read tool and the `edit`, `write`, and `apply_patch` tools in a just-bash sandbox.

## Install

```sh
npm install @better-fs-tools/just-bash @better-fs-tools/read @better-fs-tools/write just-bash
```

`just-bash` is a required peer with the range `^3.4.2`. The tests run against 3.4.2.

## Example

```ts
import { InMemoryFs } from "just-bash";
import { readOnlyFileSystem } from "@better-fs-tools/fs";
import { justBashFileSystem } from "@better-fs-tools/just-bash";
import { createReadTool, textOf } from "@better-fs-tools/read";

const bash = new InMemoryFs({ "/workspace/src/index.ts": "const a = 1;\n" });

// readOnlyFileSystem drops the write methods, so no write tool can use this view.
const read = createReadTool({
  fs: readOnlyFileSystem(
    justBashFileSystem(bash, {
      id: "sandbox",
      cwd: "/workspace",
      allowedRoots: ["/workspace"],
      maxBufferedBytes: 4 * 1024 * 1024,
    }),
  ),
});

console.log(textOf(await read({ path: "src/index.ts" })));
// 1|const a = 1;
```

The same filesystem, with the write tools:

```ts
import { InMemoryFs } from "just-bash";
import { justBashFileSystem } from "@better-fs-tools/just-bash";
import { nodeDigest } from "@better-fs-tools/node";
import { createReadTool, memoryStore, textOf } from "@better-fs-tools/read";
import { createEditTool, memoryLocks } from "@better-fs-tools/write";

const bash = new InMemoryFs({ "/workspace/src/index.ts": "const a = 1;\n" });
const fs = justBashFileSystem(bash, {
  id: "sandbox",
  cwd: "/workspace",
  allowedRoots: ["/workspace"],
  maxBufferedBytes: 4 * 1024 * 1024,
});
const shared = { fs, state: memoryStore(), digest: nodeDigest() };
const read = createReadTool(shared);
const edit = createEditTool({ ...shared, locks: memoryLocks() });

await read({ path: "src/index.ts" });
console.log(textOf(await edit({ path: "src/index.ts", edits: [{ oldText: "1", newText: "2" }] })));
// Edited src/index.ts: 1 replacement at line 1.
console.log(await bash.readFile("/workspace/src/index.ts")); // const a = 2;
```

## What the filesystem does

- `justBashFileSystem(fs, options)` takes the shared `FileSystemRootOptions` and `maxBufferedBytes` from `@better-fs-tools/fs`. It checks each path against `allowedRoots` and `denyRoots` before it touches the backend, and again after `realpath()`. `cwd` must be absolute and defaults to `/`.
- `id` defaults to `"just-bash"`. It namespaces versions, so two backends that share one state store need two ids.
- `maxBufferedBytes` defaults to 16 MiB. `just-bash` returns whole buffers, so reads are buffered. A larger file gives `too-large`, which the tools report as `TOO_LARGE`.
- Reads are buffered inside `open()`, so the whole file has left the backend before the read tool's `authorize` runs. The core still passes no byte to a classifier, a converter, or the model until `authorize` allows it. If a denied read must not reach the backend, deny it in the adapter with `denyRoots` or `allowedRoots`.
- `identity` defaults to `"none"`: change detection compares size and modification time. With `identity: "required"`, the backend's `stat()` must give an identity or a device and inode for every file. A file without one is refused as `UNSUPPORTED_BACKEND`.
- `symlinks` defaults to `"reject"`, which refuses a symlink in any component of the path, as in the Node and Cloudflare adapters. `"follow-within-roots"` follows links, and the real path must still be inside the roots.
- The resolved options are on the filesystem as `cwd`, `allowedRoots`, `denyRoots`, `maxBufferedBytes`, `identity`, and `symlinks`.
- For a read-only view, wrap it: `readOnlyFileSystem(justBashFileSystem(bash, options))` from `@better-fs-tools/fs` drops the write methods.
- Backend errors are reduced to a POSIX code and a phase. Raw messages, which can contain paths, are not passed on.
- `list()` lists directories, so suggestions and `directoryListing()` work.

## How it writes

`write()` needs `writeFile`, `mkdir`, `chmod`, and `utimes` on the backend, and `remove()` needs `rm`. They are checked when a write runs, not when the filesystem is built, so a backend without them still serves reads. A write to such a backend gives `unsupported`, which the tools report as `UNSUPPORTED_BACKEND`. The `fs` parameter has the type `JustBashBackend`: `lstat`, `realpath`, `stat`, `readFileBuffer`, and `readdir` are required, and `readdirWithFileTypes` and the write methods are optional. A full `IFileSystem` fits it, and so does a read-only backend, with no cast.

- Writes apply the same roots, deny roots, and symlink policy as `open()`. Under `"reject"`, a symlink anywhere on the path is refused. Under `"follow-within-roots"`, a link inside the roots is followed to its real path and the link stays. A link out of the roots and a dangling link are refused.
- `writeCapabilities` is `{ compareAndSwap: false }`. A write is `writeFile` and then `chmod`, so it is not atomic. `IFileSystem` has no version check, so the adapter checks the precondition with a fresh stat just before the write.
- `InMemoryFs` resets the mode to `0o644` on every write, so a replace calls `chmod` with the old mode.
- `InMemoryFs` keeps `mtime` when two writes fall in one millisecond. When a replace leaves `mtime` where it was, the adapter moves it on by one millisecond with `utimes`, so every write through the adapter changes the version.
- `identity: "required"` makes the write tools trust the version, which is the identity, size, and `mtime`. Another writer that changes a file to the same size inside the same millisecond is then not seen. With the default, `identity: "none"`, the write tools also compare the content hash of what the model read.
- There is no `stage()`. `apply_patch` writes each file in turn, and undoes them on a failure.
- `EEXIST` gives `exists`, `EROFS` gives `read-only`, and `ENOSPC` and `EDQUOT` give `no-space`.

## Bash runner

`justBashCommandRunner(bash)` runs the `bash` tool from [`@better-fs-tools/shell`](https://www.npmjs.com/package/@better-fs-tools/shell) in a just-bash `Bash`. Nothing starts a process. stdin is empty, the tool's environment replaces the shell's own, and the cwd is set for the call only.

```ts
import { Bash } from "just-bash";
import { justBashCommandRunner } from "@better-fs-tools/just-bash";
import { createBashTool, shellEnv, textOf } from "@better-fs-tools/shell";

// An emulated shell over an in-memory filesystem. Nothing starts a process.
// executionLimits stop a busy loop, because no timer fires while one runs.
const shell = new Bash({
  files: { "/workspace/notes.txt": "one\ntwo\n" },
  cwd: "/workspace",
  executionLimits: { maxCommandCount: 100_000 },
});

// shellEnv() gives defaultShellEnv only: the emulated shell sees no host variables.
const bash = createBashTool({ runner: justBashCommandRunner(shell), env: shellEnv() });

console.log(textOf(await bash({ command: "wc -l notes.txt" })));
// Exit code 0 · 0 s
// 2 notes.txt
```

just-bash buffers output, so stdout arrives whole before stderr, after the command ends. A stop aborts at the next statement boundary. A busy loop does not yield to the event loop, so no timer fires while it runs: set `executionLimits` as the backstop. Under Bun, just-bash 3.4.2 cannot apply its defense-in-depth patches and throws on `exec()`. Pass `defenseInDepth: false` there. Node runs the default.

## Links

- `docs/hosts.md` in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the defaults of every host and bundle, and what each backend can do
- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the write tools
- [`@better-fs-tools/fs`](https://www.npmjs.com/package/@better-fs-tools/fs): the filesystem contract
