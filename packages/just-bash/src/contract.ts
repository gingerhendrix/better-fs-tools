import type {
  FileSystem,
  ListOptions,
  ListOutcome,
  MutateOptions,
  MutationOutcome,
  WritableFileSystem,
} from "@better-fs-tools/fs";

export type JustBashIdentityMode = "required" | "none";
export type JustBashSymlinkPolicy = "reject" | "backend-policy";

export interface JustBashReadFileSystemOptions {
  /** Namespaces public identities and appears in `FileInfo.backend`. */
  readonly id: string;
  /** Absolute virtual POSIX working directory. Defaults to `/`. */
  readonly cwd?: string;
  /** Virtual roots that may be read. Relative values resolve against `cwd`. */
  readonly allowedRoots: readonly string[];
  /** Virtual roots that remain refused even when nested in an allowed root. */
  readonly denyRoots?: readonly string[];
  /** Maximum accepted whole-file buffer. Required so buffering is explicit. */
  readonly maxBufferedBytes: number;
  /** Stable backend identity is opt-in. Defaults to `none`. */
  readonly identity?: JustBashIdentityMode;
  /** Final symlinks are refused unless backend policy is selected explicitly. */
  readonly symlinks?: JustBashSymlinkPolicy;
}

export interface JustBashReadFileSystem extends FileSystem {
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly denyRoots: readonly string[];
  readonly maxBufferedBytes: number;
  readonly identityMode: JustBashIdentityMode;
  readonly symlinkPolicy: JustBashSymlinkPolicy;
  list(path: string, options: ListOptions): Promise<ListOutcome>;
}

/**
 * `justBashFileSystem()`: the read adapter plus whole-file writes.
 * `writeCapabilities` is `{ atomic: false, compareAndSwap: false, preserveMode: true }`.
 */
export interface JustBashFileSystem extends JustBashReadFileSystem, WritableFileSystem {
  list(path: string, options: ListOptions): Promise<ListOutcome>;
  remove(path: string, options: MutateOptions): Promise<MutationOutcome>;
}
