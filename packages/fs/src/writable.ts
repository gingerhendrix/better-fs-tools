import type {
  BackendCause,
  FileSystem,
  FileSystemError,
  FileSystemErrorReason,
  NotAFileError,
  OpenOptions,
  TooLargeError,
} from "./contract.ts";

/**
 * A FileSystem that can also create, replace, and remove whole files. Policy
 * stays in the backend: stat, write, stage, and remove apply the same roots,
 * deny roots, and symlink policy as open, and never throw for an expected
 * failure.
 */
export interface WritableFileSystem extends FileSystem {
  readonly writeCapabilities: WriteCapabilities;
  /** Resolve, check roots and type. No content read. A missing file gives exists: false with its resolved path. */
  stat(path: string, options: OpenOptions): Promise<StatOutcome>;
  /** Create or replace the whole file under the precondition. */
  write(path: string, bytes: Uint8Array, options: WriteOptions): Promise<MutationOutcome>;
  /** Present when the backend can prepare a write and publish it later. apply_patch uses it. */
  stage?(path: string, bytes: Uint8Array, options: WriteOptions): Promise<StageOutcome>;
  /** Present when the backend can remove a file. Delete and Move hunks need it. */
  remove?(path: string, options: MutateOptions): Promise<MutationOutcome>;
}

export interface WriteCapabilities {
  /**
   * The precondition is checked inside the backend, next to the publish, under the backend's own lock.
   * When false, the write tools stat the target again just before the write and check the precondition themselves.
   */
  readonly compareAndSwap: boolean;
}

export type StatOutcome =
  | { readonly ok: true; readonly stat: FileStat }
  | { readonly ok: false; readonly error: FileSystemError };

export type FileStat = ExistingFileStat | MissingFileStat;

export interface ExistingFileStat {
  readonly exists: true;
  readonly resolvedPath: string;
  readonly displayPath: string;
  readonly size: number;
  readonly mtimeMs: number | null;
  /** null unless capabilities.identity. */
  readonly identity: string | null;
  /** The same token open() reports in info.version. */
  readonly version: string;
  /** Permission bits (mode & 0o7777). null when the backend has no modes. */
  readonly mode: number | null;
  /** Link count. null when unknown. */
  readonly hardLinks: number | null;
}

export interface MissingFileStat {
  readonly exists: false;
  /** Real path of the nearest existing ancestor, joined with the missing segments. */
  readonly resolvedPath: string;
  readonly displayPath: string;
  /** Resolved paths of missing parent directories, outermost first. Empty when the parent exists. */
  readonly missingDirectories: readonly string[];
}

export type Precondition =
  /** Create only. An existing file gives reason "exists". */
  | { readonly kind: "absent" }
  /** Replace or remove only this version. Anything else gives reason "changed". */
  | { readonly kind: "version"; readonly version: string }
  /** No check. Host opt-out. */
  | { readonly kind: "any" };

export interface MutateOptions {
  readonly precondition: Precondition;
  readonly signal?: AbortSignal;
}

export interface WriteOptions extends MutateOptions {
  /** Create missing parent directories inside the roots. */
  readonly createParents: boolean;
  /** Mode for a new file. A backend with modes keeps the mode of an existing file. */
  readonly mode?: number;
}

export type MutationOutcome =
  | { readonly ok: true; readonly file: MutatedFile }
  | { readonly ok: false; readonly error: MutationError };

export interface MutatedFile {
  readonly resolvedPath: string;
  readonly displayPath: string;
  /** The version after the change. null after remove. */
  readonly version: string | null;
  readonly identity: string | null;
  readonly size: number | null;
  /** Resolved paths, outermost first. */
  readonly createdDirectories: readonly string[];
}

export type StageOutcome =
  | { readonly ok: true; readonly staged: StagedWrite }
  | { readonly ok: false; readonly error: MutationError };

export interface StagedWrite {
  readonly resolvedPath: string;
  /** Checks the precondition given to stage() again, then replaces the target. Call once. Takes no signal. */
  publish(): Promise<MutationOutcome>;
  /** Removes the staged bytes and any directory stage() created that is still empty. Idempotent. Safe after publish. */
  discard(): Promise<void>;
}

export type MutationErrorReason =
  | FileSystemErrorReason
  | "changed"
  | "exists"
  | "read-only"
  | "no-space";

export interface OtherMutationError {
  readonly reason: Exclude<MutationErrorReason, "not-a-file" | "too-large">;
  /** Non-sensitive detail for logs and notes. */
  readonly detail?: string;
  readonly cause?: BackendCause;
}

/** An error from a mutation method. Read errors are FileSystemError. */
export type MutationError = NotAFileError | TooLargeError | OtherMutationError;

/** True when `fs` has writeCapabilities, stat, and write. */
export function isWritableFileSystem(fs: FileSystem): fs is WritableFileSystem {
  const candidate = fs as Partial<WritableFileSystem>;
  return (
    typeof candidate.writeCapabilities === "object" &&
    candidate.writeCapabilities !== null &&
    typeof candidate.stat === "function" &&
    typeof candidate.write === "function"
  );
}
