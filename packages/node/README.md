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
| `nodeFileSystem(options)`      | A `FileSystem` over Node file descriptors                                                                                                                                                                                                                |
| `nodeDigest()`                 | SHA-256 over `node:crypto`. Values look like `sha256:<hex>`.                                                                                                                                                                                             |

`nodeFileSystem` options:

| Option         | Default                 | Meaning                                                                     |
| -------------- | ----------------------- | --------------------------------------------------------------------------- |
| `allowedRoots` | required                | At least one root. A path outside every root gives `OUTSIDE_ALLOWED_ROOTS`. |
| `cwd`          | `process.cwd()`         | Base for relative paths                                                     |
| `denyRoots`    | none                    | Refused as `DANGEROUS_PATH`, in addition to `/dev`, `/proc`, and `/sys`     |
| `symlinks`     | `"follow-within-roots"` | `"reject"` refuses every symlink                                            |
| `id`           | `"node"`                | Appears in `result.file.backend`                                            |

## How it opens a file

`open()` resolves the path, checks the roots, and opens one descriptor with `O_NOFOLLOW | O_NONBLOCK`. It then checks the type on that descriptor, so a FIFO cannot block the call and a swapped path cannot change what is read. Directories, FIFOs, sockets, and devices are refused before any content byte is read. `verify()` stats the same descriptor after the read, and compares its device, inode, size, and change times.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/pi`](https://www.npmjs.com/package/@better-fs-tools/pi): the Pi tool, which builds on `nodeFileSystem`
