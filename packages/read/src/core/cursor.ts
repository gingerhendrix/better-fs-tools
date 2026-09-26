const INTERNAL_CHUNK_BYTES = 64 * 1_024;

export class AbortReadError extends Error {}

/**
 * Splits adapter chunks into bounded pieces, supports one piece of pushback,
 * validates adapter output, and races iteration against an abort signal so a
 * blocking backend cannot outlive a cancelled read.
 */
export class ByteCursor {
  private iterator: AsyncIterator<Uint8Array> | null;
  private chunk: Uint8Array | null = null;
  private pushed: Uint8Array | null = null;
  private offset = 0;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  unshift(piece: Uint8Array): void {
    if (this.pushed !== null) throw new Error("Only one byte piece can be pushed back");
    this.pushed = piece;
  }

  async next(signal: AbortSignal | undefined): Promise<IteratorResult<Uint8Array>> {
    if (this.pushed !== null) {
      const piece = this.pushed;
      this.pushed = null;
      return { done: false, value: piece };
    }
    while (this.chunk === null || this.offset >= this.chunk.byteLength) {
      this.chunk = null;
      this.offset = 0;
      const item = await this.pull(signal);
      assertIteratorResult(item);
      if (item.done) return { done: true, value: undefined };
      assertChunk(item.value);
      if (item.value.byteLength === 0) continue;
      this.chunk = item.value;
    }
    const end = Math.min(this.offset + INTERNAL_CHUNK_BYTES, this.chunk.byteLength);
    const piece = this.chunk.subarray(this.offset, end);
    this.offset = end;
    if (this.offset >= this.chunk.byteLength) {
      this.chunk = null;
      this.offset = 0;
    }
    return { done: false, value: piece };
  }

  /** Best-effort release of the adapter iterator. */
  async close(): Promise<void> {
    const iterator = this.iterator;
    this.iterator = null;
    this.chunk = null;
    this.pushed = null;
    try {
      await iterator?.return?.(undefined);
    } catch {
      // An adapter that fails to unwind is not allowed to fail the read.
    }
  }

  private async pull(signal: AbortSignal | undefined): Promise<IteratorResult<Uint8Array>> {
    const iterator = this.iterator;
    if (iterator === null) return { done: true, value: undefined };
    return raceAbort(() => iterator.next(), signal);
  }
}

/**
 * Runs `start` and settles with it, or rejects with AbortReadError as soon as
 * the signal aborts. An aborted signal rejects before `start` runs, so host
 * code that ignores the signal cannot hold the read open.
 */
export async function raceAbort<T>(
  start: () => T | Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return start();
  if (signal.aborted) throw new AbortReadError("aborted");
  let removeListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new AbortReadError("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    removeListener = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([(async () => start())(), aborted]);
  } finally {
    removeListener?.();
  }
}

function assertChunk(chunk: unknown): asserts chunk is Uint8Array {
  if (!(chunk instanceof Uint8Array)) {
    throw new TypeError("Byte source yielded a non-Uint8Array chunk");
  }
}

function assertIteratorResult(item: unknown): asserts item is IteratorResult<Uint8Array> {
  if (
    item === null ||
    typeof item !== "object" ||
    !("done" in item) ||
    typeof item.done !== "boolean"
  ) {
    throw new TypeError("Byte source returned an invalid iterator result");
  }
}
