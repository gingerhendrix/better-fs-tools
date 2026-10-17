# @better-fs-tools/node

The Node backends for Better FS Tools: the local filesystem, a SHA-256 digest on `node:crypto`, and a local command runner. Pass `nodeFileSystem()` as `fs` to any tool or bundle, such as `createReadTool()` or `createFsTools()`, and `nodeCommandRunner()` as the bash `runner`. It works on Node 24 or later, and on Bun.

## Install

```sh
npm install @better-fs-tools/node @better-fs-tools/read @better-fs-tools/write
```

The package has no peers. It needs Node 24 or later (`engines.node` is `>=24`), or Bun.

## Example

```ts
import { nodeDigest, nodeFileSystem } from "@better-fs-tools/node";
import { createReadTool, textOf } from "@better-fs-tools/read";

// The local filesystem, rooted at process.cwd(). nodeDigest() is optional: it
// gives the same values as the default sha256Digest(), faster, on node:crypto.
const cwd = process.cwd();
const read = createReadTool({
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
  digest: nodeDigest(),
});
console.log(textOf(await read({ path: "package.json", limit: 1 }))); // "1|{" and a continue note

// Your own roots and policy.
export const docsOnly = createReadTool({
  fs: nodeFileSystem({
    cwd: "/srv/app",
    allowedRoots: ["/srv/app/docs"],
    denyRoots: ["/srv/app/docs/private"],
    symlinks: "reject",
  }),
});
```

All four tools over one `nodeFileSystem`, with `createFsTools()`. The read store makes `edit` and `write` need a read first. The store and `apply_patch` are opt-in:

```ts
import { nodeFileSystem } from "@better-fs-tools/node";
import { memoryStore, textOf } from "@better-fs-tools/read";
import { createFsTools, protectPaths } from "@better-fs-tools/write";

// read, edit, write, and apply_patch over one nodeFileSystem rooted at
// process.cwd(), with one read store, one SHA-256 digest, and one lock manager.
// The read store and apply_patch are opt-in.
const tools = createFsTools({
  fs: nodeFileSystem({ allowedRoots: [process.cwd()] }),
  state: memoryStore(),
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
export async function afterShell(path: string): Promise<boolean> {
  const outcome = await tools.invalidate(path);
  // ok: false means the stat or the store failed, and a record may still be there.
  return outcome.ok;
}
```

## Contents

| Export                        | Use                                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodeFileSystem(options)`     | A `WritableFileSystem` over Node file descriptors                                                                                                                                            |
| `nodeCommandRunner(options?)` | A bash `CommandRunner`: `bash -c` in its own process group. POSIX only. See [Bash tool](#bash-tool)                                                                                          |
| `nodeDigest()`                | SHA-256 over `node:crypto`. Values look like `sha256:<hex>`, the same as the default `sha256Digest()` from `@better-fs-tools/read`, so records made with one are valid for the other. Faster |

`nodeFileSystem` options. The first six are the shared `FileSystemRootOptions` from `@better-fs-tools/fs`. The filesystem also exposes the resolved `cwd`, `allowedRoots`, `denyRoots`, `symlinks`, and `identity`:

| Option             | Default                 | Meaning                                                                                                                                                                                                        |
| ------------------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedRoots`     | required                | At least one root. A path outside every root gives `OUTSIDE_ALLOWED_ROOTS`.                                                                                                                                    |
| `cwd`              | `process.cwd()`         | Base for relative paths. A relative `cwd` resolves against `process.cwd()`                                                                                                                                     |
| `denyRoots`        | none                    | Refused as `DANGEROUS_PATH`, in addition to `/dev`, `/proc`, and `/sys`                                                                                                                                        |
| `symlinks`         | `"follow-within-roots"` | `"reject"` refuses every symlink                                                                                                                                                                               |
| `identity`         | `"required"`            | The only value: Node always reports device and inode                                                                                                                                                           |
| `id`               | `"node"`                | Appears in `result.file.backend`                                                                                                                                                                               |
| `hardLinks`        | `"in-place"`            | A replace of a file with more than one hard link. `"in-place"` writes through the link, not atomically. `"refuse"` fails with reason `denied`. A file with one link is always replaced by temp file and rename |
| `newFileMode`      | `0o666` less the umask  | Mode of a new file. A mode you set is exact: the umask does not apply to it                                                                                                                                    |
| `newDirectoryMode` | `0o777` less the umask  | Mode of a directory that `createParents` makes. A mode you set is exact                                                                                                                                        |

## How it opens a file

`open()` resolves the path, checks the roots, and opens one descriptor with `O_NOFOLLOW | O_NONBLOCK`. It then checks the type on that descriptor, so a FIFO cannot block the call and a swapped path cannot change what is read. Directories, FIFOs, sockets, and devices are refused before any content byte is read. `verify()` stats the same descriptor after the read, and compares its device, inode, size, and change times.

## How it writes a file

`stat()`, `write()`, `stage()`, and `remove()` apply the same roots, deny roots, and symlink policy as `open()`. A link inside the roots is followed, so the real file changes and the link stays. A link out of the roots and a dangling link are refused. Directories, FIFOs, sockets, and devices are refused without being opened.

A write goes to a `0o600` temp file next to the target. The bytes are written and synced, and the file gets the old mode or the new-file mode. Publishing takes an in-process lock for the real path and checks the precondition against a fresh `lstat`. A create is published with `link()`, so a concurrent creator makes it fail with `exists`. A replace is published with `rename()`. Any failure removes the temp file and the directories the write created. The version token is the read identity: device, inode, size, and both change times. `EROFS` gives `read-only`, and `ENOSPC` and `EDQUOT` give `no-space`.

`writeCapabilities` is `{ compareAndSwap: true }`. A replace is atomic and keeps the mode, and `stage()` and `remove()` exist. Some of this holds with limits:

- `compareAndSwap` holds inside one process only. The lock orders writes inside one process. Another process can still change the file between the final check and the rename, and that change is then lost.
- A replace keeps the permission bits only. The owner, the group, extended attributes, and ACLs are not kept, because `rename()` publishes a new file owned by the writing user.
- A process that dies between `stage()` and `publish()` leaves a `.<name>.<random>.tmp` file next to the target. Nothing removes it later. An `apply_patch` call stages every file first, so a process killed during its commit can leave several.
- A create links the temp file to the target, then removes the temp name. For those two system calls the new file has two links.

## Bash tool

`nodeCommandRunner()` runs `bash -c` in its own process group, with stdin on `/dev/null`. A stop sends SIGTERM to the group, and SIGKILL after the grace time. `nodeCommandRunner({ cwd })` resolves a relative `cwd` against `process.cwd()`, as `nodeFileSystem` does. Give it to `createBashTool()` from [`@better-fs-tools/shell`](https://www.npmjs.com/package/@better-fs-tools/shell), or to the `bash` options of a bundle, with an `env`. `shellEnv(() => process.env)` passes `process.env`, read on each call, with the pager and colour defaults over it. Pass a smaller `env` to narrow it, for example `shellEnv({ PATH: process.env.PATH })`. In a bundle, the bash tool gets the digest and clock of the set.

```ts
import { nodeCommandRunner, nodeFileSystem } from "@better-fs-tools/node";
import { memoryStore } from "@better-fs-tools/read";
import { shellEnv } from "@better-fs-tools/shell";
import { createFsTools } from "@better-fs-tools/write";
import type { FsToolsWithBash } from "@better-fs-tools/write";

// bash is created only because `bash` is set. With a read store, the hook makes
// the next edit of package.json need a read first, since a command may have
// changed it.
let tools: FsToolsWithBash | undefined;
tools = createFsTools({
  fs: nodeFileSystem({ cwd: "/srv/project", allowedRoots: ["/srv/project"] }),
  state: memoryStore(),
  bash: {
    runner: nodeCommandRunner({ cwd: "/srv/project", shell: "/bin/bash" }),
    env: shellEnv(() => process.env),
    afterRun: [
      {
        id: "invalidate-package-json",
        afterRun: async (outcome) => {
          const invalidated = await tools?.invalidate("package.json");
          // An empty update keeps the output and the notes.
          if (invalidated === undefined || invalidated.ok) return {};
          const warning = {
            code: "invalidate-failed",
            severity: "warning" as const,
            message: "Read package.json again before you edit it.",
          };
          return { notes: [...outcome.notes, warning] };
        },
      },
    ],
  },
});

export const { read, edit, bash } = tools;
```

The allowed roots do not limit what a command touches. The runner is POSIX only.

## Links

- `docs/hosts.md` in [`@better-fs-tools/write`](https://www.npmjs.com/package/@better-fs-tools/write): the defaults of every host and bundle, and what each backend can do
- [`@better-fs-tools/read`](https://www.npmjs.com/package/@better-fs-tools/read): every read option
- [`@better-fs-tools/pi`](https://www.npmjs.com/package/@better-fs-tools/pi): `piCwdFileSystem()` and `piCwdCommandRunner()` on its `./node` subpath build on these backends
