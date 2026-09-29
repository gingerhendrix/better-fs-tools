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
 * A file's metadata as Computer's `stat` and `lstat` return it. A structural
 * subset of `WorkspaceStatResult`.
 */
export interface CloudflareComputerStat {
  name: string;
  /** Epoch milliseconds. */
  mtime: number;
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  /** Permission bits. When absent, `stat()` reports a `null` mode. */
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
 * The write methods are optional: a filesystem without them still serves
 * reads, and a write reports `unsupported`.
 */
export interface CloudflareComputerFileSystemLike {
  readFile(path: string): Promise<ReadableStream<Uint8Array>>;
  stat(path: string): Promise<CloudflareComputerStat>;
  lstat(path: string): Promise<CloudflareComputerStat>;
  readdir(
    path: string,
    options?: { limit?: number; offset?: number },
  ): Promise<CloudflareComputerDirent[]>;
  /** With `exclusive`, fails with `EEXIST` when the file exists. */
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
 * A writable filesystem over a Cloudflare Computer workspace. Writes are atomic
 * and keep the file mode. There is no compare-and-swap and no `stage()`.
 */
export interface CloudflareComputerFileSystem
  extends WritableFileSystem, FileSystemRootSettings<"reject", "none"> {
  list(path: string, options: ListOptions): Promise<ListOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}
