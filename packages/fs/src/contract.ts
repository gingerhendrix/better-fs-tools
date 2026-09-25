/**
 * The filesystem contract. A backend resolves, authorizes, type-checks, and
 * opens a path in one call, and returns a typed error for every refusal. It
 * never throws for an expected failure.
 */
export interface FileSystem {
  /** Appears in FileInfo.backend. */
  readonly id: string;
  readonly capabilities: FileSystemCapabilities;
  readonly paths: PathOps;
  /** Resolve, authorize against roots, check the type, and open. One call, one decision. */
  open(path: string, options: OpenOptions): Promise<OpenOutcome>;
  /** Present when the backend can list. Absence disables suggestions and directory listings. */
  list?(path: string, options: ListOptions): Promise<ListOutcome>;
}

export interface FileSystemCapabilities {
  /** bytes() yields incrementally. false means one buffered chunk. */
  readonly streaming: boolean;
  /** info.identity is stable and comparable across calls. */
  readonly identity: boolean;
}

export interface OpenOptions {
  readonly signal?: AbortSignal;
}

export type OpenOutcome =
  | { readonly ok: true; readonly file: OpenFile }
  | { readonly ok: false; readonly error: FileSystemError };

export interface OpenFile {
  readonly info: OpenFileInfo;
  /** Single use. */
  bytes(): AsyncIterable<Uint8Array>;
  /** Has the object behind this handle changed since open? */
  verify(): Promise<VerifyOutcome>;
  close(): Promise<void>;
}

export interface OpenFileInfo {
  readonly resolvedPath: string;
  readonly displayPath: string;
  readonly size: number | null;
  readonly mtimeMs: number | null;
  readonly identity: string | null;
  readonly mimeType: string | null;
}

export type VerifyOutcome =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly error: FileSystemError };

export type NodeKind = "directory" | "fifo" | "socket" | "device" | "other";

export type FileSystemErrorReason =
  | "not-found"
  | "not-a-file"
  | "dangerous-path"
  | "outside-allowed-roots"
  | "permission-denied"
  | "denied"
  | "unsupported"
  | "aborted"
  | "io";

export interface BackendCause {
  readonly code: string;
  readonly phase?: string;
}

export interface NotAFileError {
  readonly reason: "not-a-file";
  readonly kind: NodeKind;
  /** Resolved and display paths, when the adapter reached the object. Needed for directory listings. */
  readonly target: { readonly resolvedPath: string; readonly displayPath: string } | null;
  readonly detail?: string;
  readonly cause?: BackendCause;
}

export interface OtherFileSystemError {
  readonly reason: Exclude<FileSystemErrorReason, "not-a-file">;
  /** Non-sensitive detail for logs and notes. */
  readonly detail?: string;
  readonly cause?: BackendCause;
}

export type FileSystemError = NotAFileError | OtherFileSystemError;

export interface ListOptions {
  readonly limit: number;
  readonly signal?: AbortSignal;
}

export type ListOutcome =
  | {
      readonly ok: true;
      readonly entries: readonly DirectoryEntry[];
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly error: FileSystemError };

export interface DirectoryEntry {
  readonly name: string;
  readonly type: "file" | "directory" | "other";
}

/** POSIX only in this release. */
export interface PathOps {
  dirname(path: string): string;
  basename(path: string): string;
  join(dir: string, name: string): string;
}
