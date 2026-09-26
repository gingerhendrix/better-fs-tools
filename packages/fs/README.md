# @better-fs-tools/fs

The filesystem contract for Better FS Tools. It also has POSIX path helpers, an in-memory filesystem, and a conformance suite for your own adapters.

The read tool in [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read) reads through a `FileSystem`. The filesystem packages (`node`, `cloudflare-shell`, `cloudflare-computer`, `just-bash`) implement it. This package has no dependencies and no peers, and imports no `node:` module.

## Install

```sh
npm install @better-fs-tools/fs
```

## Example

`memoryFileSystem()` is a complete `FileSystem` in memory. Tests and examples use it:

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool, textOf } from "@better-fs-tools/read";

const fs = memoryFileSystem({
  files: { "/src/index.ts": "export const a = 1;\n" },
  directories: ["/src/empty"],
});
fs.write("/src/b.ts", "export const b = 2;\n");

const read = createReadTool({ fs });
console.log(textOf(await read({ path: "/src/b.ts" }))); // "1|export const b = 2;"
```

## Contents

| Export                                                                                   | Use                                                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `FileSystem`, `OpenFile`, `OpenOutcome`, `FileSystemError`, and the other contract types | The interface an adapter implements                                                        |
| `memoryFileSystem(options)`                                                              | An in-memory filesystem with `write`, `remove`, `makeDirectory`, and `setMimeType`         |
| `runFileSystemConformance(fs, fixtures)`                                                 | Checks that an adapter keeps the contract. Returns a report with one entry for each check. |
| `posixPaths`, `resolvePosix`, `containsPosix`                                            | POSIX path helpers for adapters                                                            |

## The contract

- `open(path)` does the whole access decision in one call: resolve, check roots and deny roots, follow or refuse symlinks, check the type, and open. It returns one handle, or a typed error.
- A handle has `info`, a single-use `bytes()` stream, `verify()` for change detection, and `close()`.
- `list(path, { limit })` is optional. Without it, the read tool makes no suggestions and no directory listings.
- `capabilities.streaming` says whether `bytes()` streams. `capabilities.identity` says whether `info.identity` is stable across calls.
- Errors have a `reason`: `not-found`, `not-a-file`, `dangerous-path`, `outside-allowed-roots`, `permission-denied`, `denied`, `unsupported`, `aborted`, or `io`. A `not-a-file` error has a `kind` (`directory`, `fifo`, `socket`, `device`, or `other`) and, when the adapter reached the object, a `target` with its paths.
- `list()` on a path that is not a directory gives `not-found`.

Paths are POSIX only in this release.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): the read tool, and a guide to writing a filesystem adapter
- [`@better-fs-tools/node`](https://www.npmjs.com/package/@better-fs-tools/node): the Node filesystem
