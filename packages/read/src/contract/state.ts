/**
 * Session state for read observations. A store is a cache: the core never
 * fails a read because a store call failed.
 */
export interface ReadStateStore {
  get(key: string): Promise<ReadRecord | null>;
  put(key: string, record: ReadRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

/** What the core stores after a read with an observation. Never holds `host`. */
export interface ReadRecord {
  readonly schema: 1;
  readonly observationId: string;
  readonly resolvedPath: string;
  readonly identity: string | null;
  readonly contentId: string | null;
  readonly viewId: string;
  readonly observedAt: string;
  readonly wholeFileVisible: boolean;
  readonly totalsExact: boolean;
  readonly request: { readonly offset: number; readonly limit: number };
}
