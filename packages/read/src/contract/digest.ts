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

export type Clock = () => Date;
