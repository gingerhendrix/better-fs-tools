/** Canonical read input. A signature maps the model's parameter names to it. */
export interface ReadInput {
  readonly path: string;
  /** One-based source line. Default 1. */
  readonly offset?: number;
  /** Maximum source lines in the view. Default and ceiling: limits.maxLines. */
  readonly limit?: number;
}

/** A validated request. `offset` and `limit` are concrete. */
export interface ReadRequest {
  readonly path: string;
  readonly offset: number;
  readonly limit: number;
  /** True when the input set `offset` or `limit`. */
  readonly ranged: boolean;
}
