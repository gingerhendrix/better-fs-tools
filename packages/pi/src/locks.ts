import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

import type { LockManager, LockOutcome } from "@better-fs-tools/write";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface PiMutationQueueLocksOptions {
  /** How long acquire() waits for every key. Default 30 000. */
  readonly timeoutMs?: number;
}

/**
 * A lock manager on Pi's withFileMutationQueue(), the per-file queue of Pi's
 * own edit and write. A Better FS Tools edit and a Pi tool that change the same
 * file then wait for each other. The keys are the resolved paths that the
 * write tools pass, which are the real paths that Pi's queue uses.
 *
 * A caller takes the keys one after another in sorted order, inside one queue
 * slot each. On a timeout or an abort the outcome comes at once, and the slots
 * that the caller got later are given back as soon as they arrive.
 */
export function piMutationQueueLocks(options: PiMutationQueueLocksOptions = {}): LockManager {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("piMutationQueueLocks options must be an object");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive safe integer");
  }
  return Object.freeze<LockManager>({
    id: "pi-file-mutation-queue",
    acquire: (keys, { signal } = {}) => acquire(keys, signal, timeoutMs),
  });
}

function acquire(
  keys: readonly string[],
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<LockOutcome> {
  if (signal?.aborted) return Promise.resolve({ ok: false, reason: "aborted" });
  return new Promise<LockOutcome>((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      finish();
      return true;
    };
    const timer = setTimeout(
      () => settle(() => resolve({ ok: false, reason: "timeout" })),
      timeoutMs,
    );
    const onAbort = () => settle(() => resolve({ ok: false, reason: "aborted" }));
    signal?.addEventListener("abort", onAbort, { once: true });

    // Each key's queue slot stays taken until the slot callback returns. The
    // innermost callback holds every slot until release() resolves `held`.
    let release = (): void => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    const hold = (index: number): Promise<void> => {
      if (index < keys.length) {
        return withFileMutationQueue(keys[index]!, () => hold(index + 1));
      }
      let released = false;
      const granted = settle(() =>
        resolve({
          ok: true,
          release() {
            if (released) return;
            released = true;
            release();
          },
        }),
      );
      // After a timeout or an abort, give the slots back at once.
      return granted ? held : Promise.resolve();
    };
    hold(0).catch((error: unknown) => settle(() => reject(error)));
  });
}
