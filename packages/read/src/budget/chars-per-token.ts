import type { ViewBudget } from "../contract/extensions.ts";

export interface CharsPerTokenOptions {
  /** Characters per token. A positive number, for example 4. */
  ratio: number;
  /** Tokens in one view. A positive number. */
  max: number;
}

/** A token estimate with no tokenizer: measure = ceil(text.length / ratio) + 1 for the newline. */
export function charsPerToken(options: CharsPerTokenOptions): ViewBudget {
  const { ratio, max } = options ?? {};
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) {
    throw new TypeError("charsPerToken ratio must be a positive number");
  }
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) {
    throw new TypeError("charsPerToken max must be a positive number");
  }
  return Object.freeze<ViewBudget>({
    id: "chars-per-token",
    max,
    measure: (text) => Math.ceil(text.length / ratio) + 1,
  });
}
