export interface ReadLimits {
  /** Lines in the view. Default 2_000. */
  readonly maxLines: number;
  /** UTF-8 bytes of source text in the view. Default 128 KiB. */
  readonly maxViewBytes: number;
  /** Characters per line before clamping. Default 2_000. */
  readonly maxCharsPerLine: number;
  /** Bytes scanned before totals and content identity are abandoned. Default 64 MiB. */
  readonly maxScanBytes: number;
  /** Bytes given to classifiers. Default 8 KiB. Clamped to maxScanBytes. */
  readonly sampleBytes: number;
}
