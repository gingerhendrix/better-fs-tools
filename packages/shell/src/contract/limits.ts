export interface ShellLimits {
  /** Used when the input has no timeout. Default 120_000. */
  readonly defaultTimeoutMs: number;
  /** A larger input timeout is cut to this, with a note. Default 600_000. */
  readonly maxTimeoutMs: number;
  /** Time between SIGTERM and SIGKILL. The tool waits this long plus one second for the exit. Default 2_000. */
  readonly killGraceMs: number;
  /** Bytes of output in the model view. Default 30_000. */
  readonly maxOutputBytes: number;
  /** Lines of output in the model view. Default 2_000. */
  readonly maxOutputLines: number;
  /** Percent of the view budget given to the head. The tail gets the rest. Default 20. */
  readonly headPercent: number;
  /** Past this many output bytes the tool stops the command. Default 10_485_760 (10 MiB). */
  readonly maxCaptureBytes: number;
}
