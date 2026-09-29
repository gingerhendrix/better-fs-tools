import type { LockManager, LockOutcome } from "../contract/locks.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

interface Waiter {
  readonly grant: () => void;
}

/**
 * In-process locks keyed by resolved path. A caller holds every key or none:
 * on a timeout or an abort it gives back every key it took. `timeoutMs`
 * defaults to 30 000.
 */
export function memoryLocks(options: { readonly timeoutMs?: number } = {}): LockManager {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("memoryLocks options must be an object");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive safe integer");
  }
  const waitersByHeldKey = new Map<string, Waiter[]>();

  const release = (key: string): void => {
    const waiting = waitersByHeldKey.get(key);
    if (waiting === undefined) return;
    const next = waiting.shift();
    if (next === undefined) waitersByHeldKey.delete(key);
    else next.grant();
  };

  const waitForKey = (key: string, ended: Promise<void>): Promise<boolean> => {
    const waiting = waitersByHeldKey.get(key);
    if (waiting === undefined) {
      waitersByHeldKey.set(key, []);
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const waiter: Waiter = { grant: () => resolve(true) };
      waiting.push(waiter);
      void ended.then(() => {
        const index = waiting.indexOf(waiter);
        const alreadyGranted = index === -1;
        if (alreadyGranted) return;
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
          const taken = await waitForKey(key, ended);
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
