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

/** The time now. Every tool and `memoryStore` take this one clock type. */
export type Clock = () => Date;
