/**
 * Session state for read observations. A store is a cache: a failed store call
 * never fails a read.
 */
export interface ReadStateStore {
  get(key: string): Promise<ReadRecord | null>;
  put(key: string, record: ReadRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * What the read tool stores after a read with an observation, and what a write
 * tool stores after a commit. Never holds `host`.
 */
export interface ReadRecord {
  readonly schema: 2;
  /** "write" when a write tool stored it after a commit. */
  readonly origin: "read" | "write";
  readonly observationId: string;
  readonly resolvedPath: string;
  readonly identity: string | null;
  /** The backend change token. null when the backend gave none. */
  readonly version: string | null;
  /** Digest.id that made contentId and viewId. A record with another digest counts as absent. */
  readonly digest: string;
  readonly contentId: string | null;
  /** For a write record: equal to contentId. */
  readonly viewId: string;
  readonly observedAt: string;
  readonly wholeFileVisible: boolean;
  readonly totalsExact: boolean;
  /** The read range. null for a write record. */
  readonly request: { readonly offset: number; readonly limit: number } | null;
}
