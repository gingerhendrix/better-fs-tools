import type {
  FileSystemRootOptions,
  FileSystemRootSettings,
  ListOptions,
  ListOutcome,
  MutateOptions,
  MutationOutcome,
  WritableFileSystem,
} from "@better-fs-tools/fs";

/**
 * One entry as Computer's `stat`/`lstat` describe it. A structural subset of
 * `WorkspaceStatResult`: the fields this adapter reads are declared, `inode`
 * is deliberately ignored, and everything here is validated at runtime anyway.
 */
export interface CloudflareComputerStat {
  name: string;
  /** Epoch milliseconds. */
  mtime: number;
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  /**
   * Permission bits. Writes pass them back on a replace, because Computer's
   * `writeFile` sets the mode to its default otherwise. Absent or unusable
   * gives a `null` mode in `stat()`.
   */
  mode?: number;
}

/** A structural subset of Computer's `WorkspaceDirentResult`. */
export interface CloudflareComputerDirent {
  name: string;
  parentPath: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

/**
 * The filesystem methods this adapter uses. `WorkspaceFilesystem` and
 * `WorkspaceFilesystemStub` from `@cloudflare/computer@0.2.1` both satisfy it.
 *
 * The write methods are optional (decision W4): a filesystem without them still
 * serves reads, and a write reports `unsupported`.
 *
 * `readFile` is declared with one parameter on purpose. Supplying an encoding
 * or a byte window selects a different upstream overload, and this adapter must
 * only ever take the whole-object stream: the core owns windowing, and a string
 * overload would bypass byte classification entirely.
 */
export interface CloudflareComputerFileSystemLike {
  readFile(path: string): Promise<ReadableStream<Uint8Array>>;
  stat(path: string): Promise<CloudflareComputerStat>;
  lstat(path: string): Promise<CloudflareComputerStat>;
  readdir(
    path: string,
    options?: { limit?: number; offset?: number },
  ): Promise<CloudflareComputerDirent[]>;
  /** One SQL transaction. `exclusive` fails with `EEXIST`. Follows a leaf symlink; the adapter refuses one first. */
  writeFile?(
    path: string,
    content: Uint8Array,
    options?: { mode?: number; exclusive?: boolean },
  ): Promise<void>;
  mkdir?(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  rm?(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

/**
 * The shared root options, with workspace paths. `allowedRoots` holds absolute
 * paths, or paths relative to `cwd`. `cwd` must be absolute and defaults to the
 * first allowed root. `symlinks` can only be `"reject"` and `identity` only
 * `"none"`. `id` defaults to `"cloudflare-computer"`. Reads stream, so there is
 * no `maxBufferedBytes`.
 */
export interface CloudflareComputerFileSystemOptions extends FileSystemRootOptions<
  "reject",
  "none"
> {}

/**
 * writeCapabilities is `{ atomic: true, compareAndSwap: false, preserveMode: true }`.
 * There is no stage(): Computer has no rename that could publish a prepared file.
 */
export interface CloudflareComputerFileSystem
  extends WritableFileSystem, FileSystemRootSettings<"reject", "none"> {
  list(path: string, options: ListOptions): Promise<ListOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}
