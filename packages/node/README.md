# @better-fs-tools/node

The Node filesystem for Better FS Tools, a SHA-256 digest, `createNodeReadTool()`, the zero-config local read tool, and `createNodeFsTools()`, which adds `edit`, `write`, and `apply_patch` over the same filesystem and read store. It works on Node 24 or later, and on Bun.

## Install

```sh
npm install @better-fs-tools/node @better-fs-tools/read @better-fs-tools/write
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

All four tools, with one read store, so `edit` and `write` need a read first:

```ts
import { createNodeFsTools } from "@better-fs-tools/node";
import { textOf } from "@better-fs-tools/read";
import { protectPaths } from "@better-fs-tools/write";

// read, edit, write, and apply_patch over one nodeFileSystem rooted at
// process.cwd(), with one read store, one SHA-256 digest, and one lock manager.
const tools = createNodeFsTools({
  edit: { authorize: protectPaths() },
  write: { authorize: protectPaths() },
  applyPatch: { authorize: protectPaths() },
});

export async function bump(path: string): Promise<string> {
  await tools.read({ path });
  const result = await tools.edit({ path, edits: [{ oldText: "a = 1", newText: "a = 2" }] });
  return textOf(result);
}

// A shell tool changed the file: the next edit must read it first.
export async function afterShell(path: string): Promise<void> {
  await tools.invalidate(path);
}
```

## Contents

| Export                                                                                       | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createNodeReadTool(options?)`                                                               | `createReadTool()` from `@better-fs-tools/read` with Node defaults. `fs` defaults to `nodeFileSystem` rooted at `process.cwd()`. `digest` defaults to `nodeDigest()`. Pass `digest: null` to turn observations off. Every other option goes to the core.                                                                                                                                                                                                                                                                                                    |
| `createNodeFsTools(options?)`                                                                | `read`, `edit`, `write`, and `apply_patch` over one `nodeFileSystem`, one `createMemoryStore()`, one `nodeDigest()`, and one `memoryLocks()`. Options: `cwd`, `allowedRoots` (default `[cwd]`), `denyRoots`, `symlinks`, `hardLinks`, `state` (`null` turns read-before-write off), `digest`, `locks`, and per-tool options under `read`, `edit`, `write`, and `applyPatch`. The result also has `fs`, `state`, `locks`, and `invalidate(path)`. An unknown option key, or `fs`, `state`, `digest`, or `locks` inside a per-tool object, throws `TypeError` |
| `createNodeEditTool(deps?)`, `createNodeWriteTool(deps?)`, `createNodeApplyPatchTool(deps?)` | One write tool each. `fs` defaults to `nodeFileSystem` rooted at `process.cwd()`, `digest` to `nodeDigest()`. `state` stays `null`, so every update carries a `read-before-write-off` note                                                                                                                                                                                                                                                                                                                                                                  |
| `nodeFileSystem(options)`                                                                    | A `WritableFileSystem` over Node file descriptors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `nodeDigest()`                                                                               | SHA-256 over `node:crypto`. Values look like `sha256:<hex>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

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

`writeCapabilities` is `{ atomic: true, compareAndSwap: true, preserveMode: true }`, and `stage()` and `remove()` exist. Some of this holds with limits:

- `compareAndSwap` holds inside one process only. The lock orders writes inside one process. Another process can still change the file between the final check and the rename, and that change is then lost.
- A replace keeps the permission bits only. The owner, the group, extended attributes, and ACLs are not kept, because `rename()` publishes a new file owned by the writing user.
- A process that dies between `stage()` and `publish()` leaves a `.<name>.<random>.tmp` file next to the target. Nothing removes it later. An `apply_patch` call stages every file first, so a process killed during its commit can leave several.
- A create links the temp file to the target, then removes the temp name. For those two system calls the new file has two links.

## Bash tool

`createNodeBashTool()` is the zero-config local `bash` tool from [`@better-fs-tools/shell`](https://www.npmjs.com/package/@better-fs-tools/shell). It uses `nodeCommandRunner()`: `bash -c` in its own process group, stdin on `/dev/null`, SIGTERM to the group on a stop, and SIGKILL after the grace time. The environment is `process.env`, read on each call, with the pager and colour defaults over it. `createNodeFsTools()` adds the same tool as `bash`, in the same cwd. With your own `bash.runner`, an explicit `cwd` still applies: it becomes the bash `cwd` dependency. `bash.cwd` wins over both.

```ts
import { createNodeFsTools, nodeCommandRunner } from "@better-fs-tools/node";

// The four file tools and bash in one cwd. The hook makes the next edit of a
// file that a command may have changed need a read first.
let tools: ReturnType<typeof createNodeFsTools> | undefined;
tools = createNodeFsTools({
  cwd: "/srv/project",
  bash: {
    runner: nodeCommandRunner({ cwd: "/srv/project", shell: "/bin/bash" }),
    afterRun: [
      {
        id: "invalidate-package-json",
        afterRun: async (outcome) => {
          await tools?.invalidate("package.json");
          return outcome;
        },
      },
    ],
  },
});

export const { read, edit, bash } = tools;
```

The allowed roots do not limit what a command touches. The runner is POSIX only.

## Links

- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/pi`](https://www.npmjs.com/package/@better-fs-tools/pi): the Pi tool, which builds on `nodeFileSystem`
