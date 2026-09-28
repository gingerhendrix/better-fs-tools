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
 * An entry as a Shell Workspace describes it. A structural subset of Shell's
 * `FileInfo` / `FileStat`: the fields this adapter reads are declared, the rest
 * are ignored, and everything optional here is validated at runtime anyway.
 */
export interface CloudflareShellFileInfo {
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  /** Epoch milliseconds. Shell's `updatedAt`. */
  updatedAt: number;
  name?: string;
  mimeType?: string;
  target?: string;
}

/**
 * The Workspace methods this adapter uses. `@cloudflare/shell`'s `Workspace`
 * and its `WorkspaceFsLike` structural type both satisfy it.
 *
 * `lstat` is required, not optional: it is the only way to see a symlink
 * before `stat` follows it. The write methods are optional (decision W4): a
 * Workspace without them still serves reads, and a write reports
 * `unsupported`. Removal uses `rm`, not `deleteFile`, because
 * `WorkspaceFsLike` has only `rm`.
 */
export interface CloudflareShellWorkspaceLike {
  stat(path: string): Promise<CloudflareShellFileInfo | null>;
  lstat(path: string): Promise<CloudflareShellFileInfo | null>;
  readFileBytes(path: string): Promise<Uint8Array | null>;
  readDir(
    dir: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<CloudflareShellFileInfo[]>;
  /** Creates missing parents itself and follows a symlink at the leaf. The adapter checks both first. */
  writeFileBytes?(path: string, data: Uint8Array, mimeType?: string): Promise<void>;
  mkdir?(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rm?(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

/**
 * The shared root options, with Workspace paths. `allowedRoots` holds
 * absolute paths, or paths relative to `cwd`. `cwd` must be absolute and
 * defaults to the first allowed root. `symlinks` can only be `"reject"` and
 * `identity` only `"none"`. `id` defaults to `"cloudflare-shell"`.
 * `maxBufferedBytes` defaults to 16 MiB.
 */
export interface CloudflareShellFileSystemOptions
  extends FileSystemRootOptions<"reject", "none">, BufferedFileSystemOptions {}

/**
 * writeCapabilities is `{ atomic: false, compareAndSwap: false, preserveMode: false }`.
 * There is no stage(): Shell's `mv` removes the destination first, so it cannot
 * publish a prepared file safely.
 */
export interface CloudflareShellFileSystem
  extends WritableFileSystem, FileSystemRootSettings<"reject", "none"> {
  readonly maxBufferedBytes: number;
  list(path: string, options: ListOptions): Promise<ListOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}
