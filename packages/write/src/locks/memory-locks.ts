import type { LockManager, LockOutcome } from "../contract/locks.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

interface Waiter {
  readonly grant: () => void;
}

/**
 * Process-local locks keyed by resolved path. Keys are taken in the order
 * given (the core sorts them), so two callers never wait on each other in a
 * cycle. A caller waits in line for each key. On a timeout or an abort it
 * gives back every key it took, so it holds every key or none.
 */
export function memoryLocks(options: { readonly timeoutMs?: number } = {}): LockManager {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("memoryLocks options must be an object");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive safe integer");
  }
  /** A key is held while it is in the map. The array holds the callers waiting for it. */
  const queues = new Map<string, Waiter[]>();

  const release = (key: string): void => {
    const waiting = queues.get(key);
    if (waiting === undefined) return;
    const next = waiting.shift();
    if (next === undefined) queues.delete(key);
    else next.grant();
  };

  /** Resolves true when the key is taken, false when the wait ended first. */
  const take = (key: string, ended: Promise<void>): Promise<boolean> => {
    const waiting = queues.get(key);
    if (waiting === undefined) {
      queues.set(key, []);
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const waiter: Waiter = { grant: () => resolve(true) };
      waiting.push(waiter);
      void ended.then(() => {
        const index = waiting.indexOf(waiter);
        // Already granted: the key is ours, and the caller gives it back.
        if (index === -1) return;
        waiting.splice(index, 1);
        resolve(false);
      });
    });
  };

  return Object.freeze<LockManager>({
    id: "memory",
    async acquire(keys, { signal } = {}): Promise<LockOutcome> {
      if (signal?.aborted) return { ok: false, reason: "aborted" };
      let reason: "timeout" | "aborted" | null = null;
      let end: () => void = () => {};
      const ended = new Promise<void>((resolve) => {
        end = resolve;
      });
      const timer = setTimeout(() => {
        reason ??= "timeout";
        end();
      }, timeoutMs);
      const onAbort = () => {
        reason ??= "aborted";
        end();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const held: string[] = [];
      try {
        for (const key of keys) {
          const taken = await take(key, ended);
          if (taken) held.push(key);
          if (!taken || reason !== null) {
            for (const key of held.reverse()) release(key);
            return { ok: false, reason: reason ?? "timeout" };
          }
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          for (const key of [...held].reverse()) release(key);
        },
      };
    },
  });
}
