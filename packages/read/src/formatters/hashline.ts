import type { LineNumberFormatterOptions } from "./line-number.ts";

export interface HashlineGutterOptions {
  /** Characters of the line hash to show. Default 2. */
  width?: number;
}

/**
 * A "12:a3|" gutter: the line number and the start of the line's hash, so the
 * id is stable across reads and changes when the line changes. With no digest
 * the gutter is the number alone: "12|".
 */
export function hashlineGutter(
  options: HashlineGutterOptions = {},
): NonNullable<LineNumberFormatterOptions["gutter"]> {
  const width = options.width ?? 2;
  if (!Number.isSafeInteger(width) || width < 1) {
    throw new TypeError("hashlineGutter width must be a positive integer");
  }
  return (line, ctx) => {
    if (ctx.digest === null) return `${line.number}|`;
    const value = ctx.digest.hash(line.text);
    const afterAlgorithmPrefix = value.lastIndexOf(":") + 1;
    return `${line.number}:${value.slice(afterAlgorithmPrefix, afterAlgorithmPrefix + width)}|`;
  };
}
