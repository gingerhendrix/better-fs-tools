export class AbortStop extends Error {
  constructor() {
    super("aborted");
  }
}

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
