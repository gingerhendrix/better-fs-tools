# @better-fs-tools/node

The Node filesystem for Better FS Tools, a SHA-256 digest, and `createNodeReadTool()`, the zero-config local read tool. It works on Node 24 or later, and on Bun.

## Install

```sh
npm install @better-fs-tools/node @better-fs-tools/read
```

The package has no peers. It needs Node 24 or later (`engines.node` is `>=24`), or Bun.

## Example

```ts
import { createNodeReadTool, nodeFileSystem } from "@better-fs-tools/node";
import { textOf } from "@better-fs-tools/read";

// Zero config: rooted at process.cwd(), with SHA-256 observations.
const read = createNodeReadTool();
console.log(textOf(await read({ path: "package.json", limit: 1 }))); // "1|{" and a continue note

// Your own roots and policy.
export const docsOnly = createNodeReadTool({
  fs: nodeFileSystem({
    cwd: "/srv/app",
    allowedRoots: ["/srv/app/docs"],
    denyRoots: ["/srv/app/docs/private"],
    symlinks: "reject",
  }),
});
```

## Contents

| Export                         | Use                                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createNodeReadTool(options?)` | `createReadTool()` from `@better-fs-tools/read` with Node defaults. `fs` defaults to `nodeFileSystem` rooted at `process.cwd()`. `digest` defaults to `nodeDigest()`. Pass `digest: null` to turn observations off. Every other option goes to the core. |
| `nodeFileSystem(options)`      | A `WritableFileSystem` over Node file descriptors                                                                                                                                                                                                        |
| `nodeDigest()`                 | SHA-256 over `node:crypto`. Values look like `sha256:<hex>`.                                                                                                                                                                                             |

`nodeFileSystem` options:

| Option             | Default                 | Meaning                                                                                                |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `allowedRoots`     | required                | At least one root. A path outside every root gives `OUTSIDE_ALLOWED_ROOTS`.                            |
| `cwd`              | `process.cwd()`         | Base for relative paths                                                                                |
| `denyRoots`        | none                    | Refused as `DANGEROUS_PATH`, in addition to `/dev`, `/proc`, and `/sys`                                |
| `symlinks`         | `"follow-within-roots"` | `"reject"` refuses every symlink                                                                       |
| `id`               | `"node"`                | Appears in `result.file.backend`                                                                       |
| `hardLinks`        | `"refuse"`              | A replace of a file with more than one hard link. `"in-place"` writes through the link, not atomically |
| `newFileMode`      | `0o644`                 | Mode of a new file. The umask does not apply                                                           |
| `newDirectoryMode` | `0o755`                 | Mode of a directory that `createParents` makes. The umask does not apply                               |

## How it opens a file

`open()` resolves the path, checks the roots, and opens one descriptor with `O_NOFOLLOW | O_NONBLOCK`. It then checks the type on that descriptor, so a FIFO cannot block the call and a swapped path cannot change what is read. Directories, FIFOs, sockets, and devices are refused before any content byte is read. `verify()` stats the same descriptor after the read, and compares its device, inode, size, and change times.

## How it writes a file

`stat()`, `write()`, `stage()`, and `remove()` apply the same roots, deny roots, and symlink policy as `open()`. A link inside the roots is followed, so the real file changes and the link stays. A link out of the roots and a dangling link are refused. Directories, FIFOs, sockets, and devices are refused without being opened.

A write goes to a `0o600` temp file next to the target. The bytes are written and synced, and the file gets the old mode or the new-file mode. Publishing takes an in-process lock for the real path and checks the precondition against a fresh `lstat`. A create is published with `link()`, so a concurrent creator makes it fail with `exists`. A replace is published with `rename()`. Any failure removes the temp file and the directories the write created. The version token is the read identity: device, inode, size, and both change times. `EROFS` gives `read-only`, and `ENOSPC` and `EDQUOT` give `no-space`.

The lock orders writes inside one process. Another process can still change the file between the final check and the rename, and that change is then lost.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/pi`](https://www.npmjs.com/package/@better-fs-tools/pi): the Pi tool, which builds on `nodeFileSystem`
