import type { ShellPhase } from "../contract/result.ts";

/** Thrown when the caller's signal aborted before the command started. `phase` names the stage. */
export class AbortStop extends Error {
  constructor(readonly phase: ShellPhase = "run") {
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

export function delay(ms: number): { readonly done: Promise<void>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    unref(timer);
  });
  return { done, cancel: () => clearTimeout(timer) };
}

export function unref(timer: unknown): void {
  if (timer !== null && typeof timer === "object" && "unref" in timer) {
    const { unref: release } = timer as { unref?: unknown };
    if (typeof release === "function") release.call(timer);
  }
}
