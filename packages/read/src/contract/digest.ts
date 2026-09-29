export interface Digest {
  readonly id: string;
  /** Incremental hash over scanned bytes. */
  create(): DigestStream;
  /** One-shot hash of a string. */
  hash(value: string): string;
}

export interface DigestStream {
  update(bytes: Uint8Array): void;
  digest(): string;
}

/** Returns the current time. Every tool and `memoryStore` take this clock type. */
export type Clock = () => Date;
