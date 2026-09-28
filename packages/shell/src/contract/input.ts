/** The canonical input. A signature maps the model's input to it. */
export interface BashInput {
  readonly command: string;
  /** Milliseconds. Clamped to limits.maxTimeoutMs. Default limits.defaultTimeoutMs. */
  readonly timeoutMs?: number;
  /** Relative to the default cwd, or absolute. Default the default cwd. */
  readonly cwd?: string;
}

/** The input after parse: every field set. */
export interface BashRequest {
  readonly command: string;
  readonly timeoutMs: number;
  /** The requested cwd, as the model sent it. null when left out. */
  readonly cwd: string | null;
}
