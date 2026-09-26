import type { ClassificationSample } from "../contract/classify.ts";
import type { Digest, DigestStream } from "../contract/digest.ts";
import type { CallScope } from "./call-scope.ts";
import { AbortReadError } from "./cursor.ts";
import type { ByteCursor } from "./cursor.ts";

/** Thrown into the converter past limits.maxConvertBytes. Internal: the core maps it to TOO_LARGE. */
export class ConvertLimitError extends Error {}

/**
 * The byte stream a file converter reads: the sample, then the rest of the
 * cursor, from byte 0. It counts and hashes every byte, checks the signal
 * before each chunk, and throws ConvertLimitError past the cap. The flags
 * outlive a converter that catches the error, so the core still sees them.
 */
export class ConvertSource<THost> {
  /** Source bytes read so far. */
  count = 0;
  /** True once a read went past the cap, even if the converter caught the error. */
  exceeded = false;
  /** True when the stream reached EOF within the cap. */
  reachedEof = false;
  /** A backend or adapter failure, kept so the core reports it as the core would without a converter. */
  failure: unknown = null;
  private readonly hash: DigestStream | null;
  private id: string | null | undefined;
  private sampleSent = false;
  private started = false;

  constructor(
    private readonly cursor: ByteCursor,
    private readonly sample: ClassificationSample,
    private readonly limit: number,
    digest: Digest | null,
    private readonly scope: CallScope<THost>,
  ) {
    this.hash = digest === null ? null : digest.create();
  }

  /** The converter's single-use stream. */
  bytes(): AsyncIterable<Uint8Array> {
    if (this.started) throw new TypeError("the converter source is single use");
    this.started = true;
    return this.iterate();
  }

  /** Reads what the converter left, so the hash and the size check cover the whole source. */
  async drain(): Promise<void> {
    this.started = true;
    while ((await this.pull()) !== null) {
      // Counted and hashed in pull().
    }
  }

  /** Hash of every source byte. null without a digest or before EOF. Computed once. */
  contentId(): string | null {
    if (!this.reachedEof) return null;
    this.id ??= this.hash?.digest() ?? null;
    return this.id;
  }

  private async *iterate(): AsyncGenerator<Uint8Array> {
    for (;;) {
      const chunk = await this.pull();
      if (chunk === null) return;
      yield chunk;
    }
  }

  private async pull(): Promise<Uint8Array | null> {
    if (this.exceeded) throw new ConvertLimitError("conversion limit exceeded");
    if (this.reachedEof) return null;
    this.scope.checkAbort();
    const chunk = await this.nextChunk();
    if (chunk === null) {
      this.reachedEof = true;
      return null;
    }
    if (this.count + chunk.byteLength > this.limit) {
      this.exceeded = true;
      throw new ConvertLimitError("conversion limit exceeded");
    }
    this.count += chunk.byteLength;
    this.hash?.update(chunk);
    return chunk;
  }

  private async nextChunk(): Promise<Uint8Array | null> {
    if (!this.sampleSent) {
      this.sampleSent = true;
      if (this.sample.bytes.byteLength > 0) return this.sample.bytes;
    }
    try {
      const item = await this.cursor.next(this.scope.signal);
      return item.done ? null : item.value;
    } catch (error) {
      if (!(error instanceof AbortReadError)) this.failure ??= error;
      throw error;
    }
  }
}
