import type { ReadFormatter } from "../contract/format.ts";
import type { ReadReport } from "../contract/result.ts";

export function isDirectory(outcome: ReadReport): boolean {
  return outcome.status === "ok" && outcome.classification.kind === "directory";
}

export function preset(
  id: string,
  file: ReadFormatter<unknown>,
  directory: ReadFormatter<unknown> = file,
): ReadFormatter<unknown> {
  return Object.freeze<ReadFormatter<unknown>>({
    id,
    format: (outcome, ctx) => (isDirectory(outcome) ? directory : file).format(outcome, ctx),
  });
}
