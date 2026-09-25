import type { ReadRecord, ReadStateStore } from "../contract/state.ts";

const DEFAULT_MAX_ENTRIES = 1_000;
const DEFAULT_TTL_MS = 30 * 60 * 1_000;

export interface MemoryStoreOptions {
  /** Default 1_000. */
  readonly maxEntries?: number;
  /** Default 30 minutes. */
  readonly ttlMs?: number;
  /** Milliseconds. Default Date.now. */
  readonly clock?: () => number;
}

/**
 * A process-local, capped, TTL store.
 *
 * Scope belongs to the store, not to its call signatures: one session gets one
 * store, and a shared store namespaces its own keys.
 */
export function createMemoryStore(options: MemoryStoreOptions = {}): ReadStateStore {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("memory store options must be an object");
  }
  const maxEntries = positiveInteger(options.maxEntries ?? DEFAULT_MAX_ENTRIES, "maxEntries");
  const ttlMs = positiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, "ttlMs");
  const clock = options.clock ?? Date.now;
  if (typeof clock !== "function") throw new TypeError("clock must be a function");

  const entries = new Map<string, { record: ReadRecord; expiresAt: number }>();

  const now = (): number => {
    const value = clock();
    if (!Number.isFinite(value)) {
      throw new TypeError("clock must return a finite millisecond timestamp");
    }
    return value;
  };

  const prune = (time: number): void => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= time) entries.delete(key);
    }
  };

  return Object.freeze({
    async get(key: string): Promise<ReadRecord | null> {
      assertKey(key);
      const time = now();
      prune(time);
      const entry = entries.get(key);
      if (entry === undefined) return null;
      // Refresh recency without extending the TTL.
      entries.delete(key);
      entries.set(key, entry);
      return entry.record;
    },
    async put(key: string, record: ReadRecord): Promise<void> {
      assertKey(key);
      if (record === null || typeof record !== "object") {
        throw new TypeError("record must be an object");
      }
      const time = now();
      prune(time);
      entries.delete(key);
      entries.set(key, { record, expiresAt: time + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    async delete(key: string): Promise<void> {
      assertKey(key);
      entries.delete(key);
    },
  });
}

function assertKey(key: string): void {
  if (typeof key !== "string" || key === "") {
    throw new TypeError("store key must be a non-empty string");
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}
