import type {
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
export interface ShellFileInfo {
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
 * before `stat` follows it. Removal uses `rm`, not `deleteFile`, because
 * `WorkspaceFsLike` has only `rm`.
 */
export interface ShellWorkspaceLike {
  stat(path: string): Promise<ShellFileInfo | null>;
  lstat(path: string): Promise<ShellFileInfo | null>;
  readFileBytes(path: string): Promise<Uint8Array | null>;
  readDir(dir: string, opts?: { limit?: number; offset?: number }): Promise<ShellFileInfo[]>;
  /** Creates missing parents itself and follows a symlink at the leaf. The adapter checks both first. */
  writeFileBytes(path: string, data: Uint8Array, mimeType?: string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

export interface ShellWorkspaceFileSystemOptions {
  /** Absolute POSIX path. Nothing outside it is readable, listable or writable. */
  root: string;
  /**
   * Ceiling on one buffered object, applied to the size Shell reports and to
   * the length it returns. A larger read or write is refused as `too-large`.
   * Defaults to 4 MiB.
   */
  maxBufferedBytes?: number;
  id?: string;
}

/**
 * writeCapabilities is `{ atomic: false, compareAndSwap: false, preserveMode: false }`.
 * There is no stage(): Shell's `mv` removes the destination first, so it cannot
 * publish a prepared file safely.
 */
export interface ShellWorkspaceFileSystem extends WritableFileSystem {
  readonly root: string;
  readonly maxBufferedBytes: number;
  list(path: string, options: ListOptions): Promise<ListOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}
