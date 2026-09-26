import type { Formatter } from "../contract/format.ts";
import type { ReadOutcome } from "../contract/result.ts";

export function isDirectory(outcome: ReadOutcome): boolean {
  return outcome.status === "ok" && outcome.classification.kind === "directory";
}

/** A named formatter that gives directory listings to `directory` and every other outcome to `file`. */
export function preset(
  id: string,
  file: Formatter<unknown>,
  directory: Formatter<unknown> = file,
): Formatter<unknown> {
  return Object.freeze<Formatter<unknown>>({
    id,
    format: (outcome, ctx) => (isDirectory(outcome) ? directory : file).format(outcome, ctx),
  });
}
