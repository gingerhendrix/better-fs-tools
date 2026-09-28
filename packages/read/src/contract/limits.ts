export interface ReadLimits {
  /** Lines in the view. Default 2_000. */
  readonly maxLines: number;
  /** UTF-8 bytes of source text in the view. Default 128 KiB. */
  readonly maxViewBytes: number;
  /** Characters per line before clamping. Default 2_000. */
  readonly maxCharsPerLine: number;
  /** Bytes scanned before totals and content identity are abandoned. Default 64 MiB. */
  readonly maxScanBytes: number;
  /** Bytes given to classifiers. Default 8 KiB. Must not be more than maxScanBytes. */
  readonly sampleBytes: number;
  /** Entries in one directory listing. Default 200. */
  readonly maxDirectoryEntries: number;
  /** Suggested names on a miss. Default 5. */
  readonly maxSuggestions: number;
  /** Source bytes a converter may read. Default 64 MiB. */
  readonly maxConvertBytes: number;
  /** Total bytes of media parts in one result. Default 5 MiB. */
  readonly maxMediaBytes: number;
}
