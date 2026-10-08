import type { IFileSystem } from "just-bash";

import type {
  BufferedFileSystemOptions,
  FileSystemRootOptions,
  FileSystemRootSettings,
  ListOptions,
  ListOutcome,
  MutateOptions,
  MutationOutcome,
  WritableFileSystem,
} from "@better-fs-tools/fs";

/**
 * The part of the just-bash `IFileSystem` this package needs. Reads need
 * `lstat`, `realpath`, `stat`, `readFileBuffer`, and `readdir`, and use
 * `readdirWithFileTypes` when it is there. The write methods are optional, so
 * a read-only backend fits this type and still serves reads. A full
 * `IFileSystem` fits too.
 */
export type JustBashBackend = Pick<
  IFileSystem,
  "lstat" | "realpath" | "stat" | "readFileBuffer" | "readdir"
> &
  Partial<
    Pick<IFileSystem, "readdirWithFileTypes" | "writeFile" | "mkdir" | "chmod" | "utimes" | "rm">
  >;

/**
 * The shared root options, with virtual paths. `cwd` must be absolute and
 * defaults to `/`; relative roots resolve against it. `id` defaults to
 * `"just-bash"` and namespaces versions and identities, so give two backends
 * that share one state store two ids. `symlinks` defaults to `"reject"`, which
 * refuses a link in any component. `identity` defaults to `"none"`.
 * `maxBufferedBytes` defaults to 16 MiB.
 */
export interface JustBashFileSystemOptions
  extends FileSystemRootOptions, BufferedFileSystemOptions {}

/**
 * `writeCapabilities` is `{ compareAndSwap: false }`.
 * The write methods need `writeFile`, `mkdir`, `chmod`, `utimes`, and `rm` on
 * the backend. They are checked when a write runs, so a backend without them
 * still serves reads.
 */
export interface JustBashFileSystem extends WritableFileSystem, FileSystemRootSettings {
  readonly maxBufferedBytes: number;
  list(path: string, options: ListOptions): Promise<ListOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}
