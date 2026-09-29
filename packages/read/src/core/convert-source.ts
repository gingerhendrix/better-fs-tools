import type { ClassificationSample } from "../contract/classify.ts";
import type { Digest, DigestStream } from "../contract/digest.ts";
import type { CallScope } from "./call-scope.ts";
import { AbortReadError } from "./cursor.ts";
import type { ByteCursor } from "./cursor.ts";

export class ConvertLimitError extends Error {}

export class ConvertSource<THost> {
  bytesRead = 0;
  /** Stays set even when the converter catches the ConvertLimitError. */
  exceeded = false;
  reachedEof = false;
  /** Stays set even when the converter catches the backend error. */
  backendFailure: unknown = null;
  private readonly hash: DigestStream | null;
  private cachedContentId: string | null | undefined;
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

  bytes(): AsyncIterable<Uint8Array> {
    if (this.started) throw new TypeError("the converter source is single use");
    this.started = true;
    return this.iterate();
  }

  async drain(): Promise<void> {
    this.started = true;
    while ((await this.pull()) !== null) {}
  }

  contentId(): string | null {
    if (!this.reachedEof) return null;
    this.cachedContentId ??= this.hash?.digest() ?? null;
    return this.cachedContentId;
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
    if (this.bytesRead + chunk.byteLength > this.limit) {
      this.exceeded = true;
      throw new ConvertLimitError("conversion limit exceeded");
    }
    this.bytesRead += chunk.byteLength;
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
      if (!(error instanceof AbortReadError)) this.backendFailure ??= error;
      throw error;
    }
  }
}
