# @better-fs-tools/fs

The filesystem contract for Better FS Tools, for reads and for writes. It also has POSIX path helpers, an in-memory filesystem, and conformance suites for your own adapters.

The read tool in [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read) reads through a `FileSystem`. The `edit`, `write`, and `apply_patch` tools in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write) write through a `WritableFileSystem`. The filesystem packages (`node`, `cloudflare-shell`, `cloudflare-computer`, `just-bash`) implement both. This package has no dependencies and no peers, and imports no `node:` module.

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
fs.setFile("/src/b.ts", "export const b = 2;\n");

const read = createReadTool({ fs });
console.log(textOf(await read({ path: "/src/b.ts" }))); // "1|export const b = 2;"
```

## Contents

| Export                                                                                                                                         | Use                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `FileSystem`, `OpenFile`, `OpenOutcome`, `FileSystemError`, and the other contract types                                                       | The interface an adapter implements                                                                                  |
| `WritableFileSystem`, `FileStat`, `Precondition`, `WriteOptions`, `MutationOutcome`, `StagedWrite`, `MutationError`, and the other write types | The write contract. It extends `FileSystem`                                                                          |
| `isWritableFileSystem(fs)`                                                                                                                     | True when `fs` has `writeCapabilities`, `stat`, and `write`                                                          |
| `readOnlyFileSystem(fs)`                                                                                                                       | A view of any backend with only the read members. A write tool refuses it                                            |
| `FileSystemRootOptions`, `BufferedFileSystemOptions`, `FileSystemRootSettings`, `SymlinkPolicy`, `IdentityMode`, `DEFAULT_MAX_BUFFERED_BYTES`  | The options every adapter takes for roots, symlinks, identity, and buffering                                         |
| `memoryFileSystem(options)`                                                                                                                    | An in-memory `WritableFileSystem`. Test helpers: `setFile`, `deleteFile`, `makeDirectory`, `setMimeType`, and `peek` |
| `runFileSystemConformance(fs, fixtures)`                                                                                                       | Checks that an adapter keeps the read contract. Returns a report with one entry for each check.                      |
| `runWritableFileSystemConformance(fs, fixtures)`                                                                                               | Checks the write contract. It creates and removes files in `fixtures.scratchDirectory`                               |
| `posixPaths`, `resolvePosix`, `containsPosix`                                                                                                  | POSIX path helpers for adapters                                                                                      |

## The contract

- `open(path)` does the whole access decision in one call: resolve, check roots and deny roots, follow or refuse symlinks, check the type, and open. It returns one handle, or a typed error.
- A handle has `info`, a single-use `bytes()` stream, `verify()` for change detection, and `close()`.
- `list(path, { limit })` is optional. Without it, the read tool makes no suggestions and no directory listings.
- `capabilities.streaming` says whether `bytes()` streams. `capabilities.identity` says whether `info.identity` is stable across calls.
- Errors have a `reason`: `not-found`, `not-a-file`, `dangerous-path`, `outside-allowed-roots`, `permission-denied`, `denied`, `too-large`, `unsupported`, `aborted`, or `io`. A `too-large` error has the backend's byte `limit` and the `size` it saw (or `null`), and the tools report it as `TOO_LARGE`. A `not-a-file` error has a `kind` (`directory`, `fifo`, `socket`, `device`, or `other`) and, when the adapter reached the object, a `target` with its paths.
- `list()` on a path that is not a directory gives `not-found`.

## The write contract

A `WritableFileSystem` adds whole-file writes. The backend keeps the policy: `stat`, `write`, `stage`, and `remove` apply the same roots, deny roots, and symlink rules as `open`, and never throw for an expected failure.

```ts
import { memoryFileSystem } from "@better-fs-tools/fs";

const fs = memoryFileSystem({ files: { "/notes.txt": "one\n" } });
const stat = await fs.stat("/notes.txt", {});
if (stat.ok && stat.stat.exists) {
  const outcome = await fs.write("/notes.txt", new TextEncoder().encode("two\n"), {
    precondition: { kind: "version", version: stat.stat.version },
    createParents: false,
  });
  console.log(outcome.ok); // true
}
```

- `stat(path)` resolves and checks the type without reading content. A missing file gives `exists: false`, its resolved path, and the missing parent directories.
- `write(path, bytes, options)` creates or replaces the whole file. The `precondition` is `absent` (create only), `version` (replace only that version), or `any`. `createParents` creates missing parents and the result lists them.
- `stage(path, bytes, options)` is optional. It prepares a write. `publish()` checks the precondition again and replaces the target. `discard()` removes the staged bytes and any directory `stage()` created that is still empty.
- `remove(path, options)` is optional. Its presence is the capability.
- `version` changes with every change of the bytes. `stat().version` equals `open().info.version` for the same file.
- `writeCapabilities` reports `atomic`, `compareAndSwap`, and `preserveMode`.
- Mutation errors add four reasons to the read reasons: `changed`, `exists`, `read-only`, and `no-space`. A byte ceiling of the backend is `too-large`, not `no-space`.

The write tools turn each `false` in `writeCapabilities` into a note for the model, and check the precondition themselves just before the write when `compareAndSwap` is false. `docs/architecture.md` in `@better-fs-tools/write` has a guide to writing a writable adapter.

| Adapter                          | `atomic` | `compareAndSwap`    | `preserveMode` | `stage()` | `remove()` |
| -------------------------------- | -------- | ------------------- | -------------- | --------- | ---------- |
| `memoryFileSystem()`             | yes      | yes                 | yes            | yes       | yes        |
| `nodeFileSystem()`               | yes      | yes, in one process | yes            | yes       | yes        |
| `cloudflareShellFileSystem()`    | no       | no                  | no             | no        | yes        |
| `cloudflareComputerFileSystem()` | yes      | no                  | yes            | no        | yes        |
| `justBashFileSystem()`           | no       | no                  | yes            | no        | yes        |

`memoryFileSystem` checks the precondition and publishes in one synchronous step. Its options `readOnly`, `faults`, `stage: false`, `remove: false`, and `writeCapabilities` let tests simulate other backends.

Paths are POSIX only in this release.

## Shared adapter options

Every filesystem adapter takes `FileSystemRootOptions` for the same ideas, with the same names:

| Option             | Meaning                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedRoots`     | Required, at least one. A path outside every root gives `outside-allowed-roots`                                                             |
| `denyRoots`        | Refused even inside an allowed root, with reason `dangerous-path` in every adapter                                                          |
| `cwd`              | Relative requests and relative roots resolve against it                                                                                     |
| `symlinks`         | `"reject"` refuses a link in any component of the path. `"follow-within-roots"` follows links, and the real path must stay inside the roots |
| `identity`         | `"required"`: a stable identity, and versions that trust it. `"none"`: no identity, and weak versions                                       |
| `id`               | Optional everywhere. It appears in `FileInfo.backend` and in versions                                                                       |
| `maxBufferedBytes` | Only in adapters that buffer whole files (`BufferedFileSystemOptions`). Default 16 MiB. A larger file gives `too-large`                     |

An adapter narrows a union where its backend cannot do the rest, and says so in its type. The adapters expose the resolved values as `FileSystemRootSettings` (`cwd`, `allowedRoots`, `denyRoots`, `symlinks`, `identity`).

| Adapter                          | `cwd` default            | `symlinks`                            | `identity`                 | `maxBufferedBytes` | `id` default            |
| -------------------------------- | ------------------------ | ------------------------------------- | -------------------------- | ------------------ | ----------------------- |
| `nodeFileSystem()`               | `process.cwd()`          | both, default `"follow-within-roots"` | `"required"` only          | none, it streams   | `"node"`                |
| `justBashFileSystem()`           | `/`                      | both, default `"reject"`              | both, default `"none"`     | 16 MiB             | `"just-bash"`           |
| `memoryFileSystem()`             | none, paths are absolute | links do not exist                    | both, default `"required"` | 16 MiB             | `"memory"`              |
| `cloudflareShellFileSystem()`    | the first allowed root   | `"reject"` only                       | `"none"` only              | 16 MiB             | `"cloudflare-shell"`    |
| `cloudflareComputerFileSystem()` | the first allowed root   | `"reject"` only                       | `"none"` only              | none, it streams   | `"cloudflare-computer"` |

`memoryFileSystem()` has no allowed roots: every absolute path is inside. It takes `id`, `denyRoots`, `identity`, and `maxBufferedBytes`.

`readOnlyFileSystem(fs)` wraps any backend and keeps only `id`, `capabilities`, `paths`, `open`, and `list`. The result is a plain `FileSystem`, so a write tool refuses it when it is built:

```ts
import { isWritableFileSystem, memoryFileSystem, readOnlyFileSystem } from "@better-fs-tools/fs";
import { createReadTool, textOf } from "@better-fs-tools/read";

// Any backend, with the write methods dropped. A read tool works as before,
// and a write tool refuses it when it is built.
const fs = readOnlyFileSystem(memoryFileSystem({ files: { "/notes.txt": "one\n" } }));
console.log(isWritableFileSystem(fs)); // false

const read = createReadTool({ fs });
console.log(textOf(await read({ path: "/notes.txt" }))); // "1|one"
```

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): the read tool, and a guide to writing a filesystem adapter
- [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the write tools
- [`@better-fs-tools/node`](https://www.npmjs.com/package/@better-fs-tools/node): the Node filesystem
