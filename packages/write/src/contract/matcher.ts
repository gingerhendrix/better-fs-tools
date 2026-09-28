export interface MatchContext {
  /** "lines": ranges start at a line start and end at a line end. Patch hunks use it. */
  readonly mode: "text" | "lines";
  /** First UTF-16 index a range may start at. */
  readonly from: number;
  /** Stop after this many ranges. */
  readonly maxMatches: number;
}

export interface MatchRange {
  /** UTF-16 offsets into the haystack as given. */
  readonly start: number;
  readonly end: number;
  /** Set when an edge of the hit falls inside a folded span. The core refuses it with a clear message. */
  readonly refused?: "boundary";
}

export interface Matcher {
  readonly id: string;
  /** true when a hit is not byte-exact. The result reports it. */
  readonly fuzzy: boolean;
  /** Short phrase for the tool description, for example "trailing whitespace". */
  readonly describe: string;
  /** Ranges in order. Must not throw for any string input. */
  find(haystack: string, needle: string, ctx: MatchContext): readonly MatchRange[];
  /** Rewrite newText for one hit, for example to re-indent it. Default: newText unchanged. */
  adapt?(
    newText: string,
    hit: { readonly haystack: string; readonly needle: string; readonly range: MatchRange },
  ): string;
}
