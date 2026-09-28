/**
 * Options that every filesystem adapter takes for the same ideas, with the
 * same names and the same meaning. An adapter extends these and narrows a
 * union where its backend cannot do the rest.
 */

/**
 * How an adapter treats a symbolic link on a requested path.
 *
 * - `"reject"`: a link in any component of the path, parent or leaf, is
 *   refused with reason `denied`.
 * - `"follow-within-roots"`: links are followed, and the real path must still
 *   be inside the allowed roots and outside the deny roots.
 */
export type SymlinkPolicy = "follow-within-roots" | "reject";

/**
 * `"required"`: the adapter reports a stable identity (`capabilities.identity`
 * is true) and refuses a file whose identity it cannot read. `"none"`: no
 * identity, and versions are weak (size and modification time).
 */
export type IdentityMode = "required" | "none";

/** 16 MiB: the default `maxBufferedBytes` of every adapter that buffers whole files. */
export const DEFAULT_MAX_BUFFERED_BYTES = 16 * 1024 * 1024;

/**
 * Root options. `TSymlinks` and `TIdentity` narrow the unions to what an
 * adapter supports.
 */
export interface FileSystemRootOptions<
  TSymlinks extends SymlinkPolicy = SymlinkPolicy,
  TIdentity extends IdentityMode = IdentityMode,
> {
  /** Appears in `FileInfo.backend` and in versions. Optional; each adapter has a default. */
  readonly id?: string;
  /** Relative requests and relative roots resolve against it. Each adapter documents its default. */
  readonly cwd?: string;
  /** At least one. A path outside every root is refused as `outside-allowed-roots`. */
  readonly allowedRoots: readonly string[];
  /** Refused even inside an allowed root. */
  readonly denyRoots?: readonly string[];
  readonly symlinks?: TSymlinks;
  readonly identity?: TIdentity;
}

/** For adapters that hold a whole file in memory. */
export interface BufferedFileSystemOptions {
  /**
   * Ceiling on one file, in bytes, for reads and writes. A larger file gives
   * reason `too-large`. Default `DEFAULT_MAX_BUFFERED_BYTES` (16 MiB).
   */
  readonly maxBufferedBytes?: number;
}

/** The resolved root options, as an adapter exposes them. Paths are absolute. */
export interface FileSystemRootSettings<
  TSymlinks extends SymlinkPolicy = SymlinkPolicy,
  TIdentity extends IdentityMode = IdentityMode,
> {
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly denyRoots: readonly string[];
  readonly symlinks: TSymlinks;
  readonly identity: TIdentity;
}
