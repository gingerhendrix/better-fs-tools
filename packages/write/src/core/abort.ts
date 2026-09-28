/** Thrown when the caller's signal aborted. The pipeline maps it to ABORTED with the phase. */
export class AbortStop extends Error {
  constructor() {
    super("aborted");
  }
}

/**
 * Runs `start` and settles with it, or rejects with AbortStop as soon as the
 * signal aborts. An aborted signal rejects before `start` runs, so host code
 * that ignores the signal cannot hold the call open.
 */
export async function raceAbort<T>(
  start: () => T | Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return start();
  if (signal.aborted) throw new AbortStop();
  let removeListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new AbortStop());
    signal.addEventListener("abort", onAbort, { once: true });
    removeListener = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([(async () => start())(), aborted]);
  } finally {
    removeListener?.();
  }
}
