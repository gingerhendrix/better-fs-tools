import type {
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
export interface ComputerStat {
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
export interface ComputerDirent {
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
 * `readFile` is declared with one parameter on purpose. Supplying an encoding
 * or a byte window selects a different upstream overload, and this adapter must
 * only ever take the whole-object stream: the core owns windowing, and a string
 * overload would bypass byte classification entirely.
 */
export interface ComputerFileSystemLike {
  readFile(path: string): Promise<ReadableStream<Uint8Array>>;
  stat(path: string): Promise<ComputerStat>;
  lstat(path: string): Promise<ComputerStat>;
  readdir(path: string, options?: { limit?: number; offset?: number }): Promise<ComputerDirent[]>;
  /** One SQL transaction. `exclusive` fails with `EEXIST`. Follows a leaf symlink; the adapter refuses one first. */
  writeFile(
    path: string,
    content: Uint8Array,
    options?: { mode?: number; exclusive?: boolean },
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

export interface ComputerFileSystemOptions {
  /** Absolute POSIX path. Nothing outside it is readable, listable or writable. */
  root: string;
  id?: string;
}

/**
 * writeCapabilities is `{ atomic: true, compareAndSwap: false, preserveMode: true }`.
 * There is no stage(): Computer has no rename that could publish a prepared file.
 */
export interface ComputerFileSystem extends WritableFileSystem {
  readonly root: string;
  list(path: string, options: ListOptions): Promise<ListOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}
