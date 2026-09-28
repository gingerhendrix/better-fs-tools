export interface WriteLimits {
  /** Bytes of an existing file that any tool loads. Default 8 MiB. */
  readonly maxFileBytes: number;
  /** Encoded bytes of new content for one file. Default 8 MiB. */
  readonly maxWriteBytes: number;
  /** UTF-8 bytes of patch text, like every other *Bytes limit. Default 4 MiB (4_194_304). */
  readonly maxPatchBytes: number;
  /** Operations in one patch. Default 100. */
  readonly maxPatchFiles: number;
  /** Pairs in one edit call. Default 100. */
  readonly maxEdits: number;
  /** Bytes given to classifiers and codecs. Default 8_192. */
  readonly sampleBytes: number;
  /** Context lines before and after each change in a snippet. Default 3. */
  readonly snippetLines: number;
  /** Snippet lines for one file in the model text. Default 40. */
  readonly maxSnippetLines: number;
  /** Lines of unified diff kept in FileChange.diff. Default 2_000. */
  readonly maxDiffLines: number;
  /** Lines in a not-found hint. Default 12. */
  readonly maxHintLines: number;
  /** Line numbers listed for an ambiguous match. Default 10. */
  readonly maxListedMatches: number;
  /** Problems listed for a failed patch verify. Default 20. */
  readonly maxPatchProblems: number;
}
