import type { ReadContext } from "./context.ts";
import type { Digest } from "./digest.ts";
import type { ReadLimits } from "./limits.ts";
import type { ContentPart, ReadReport } from "./result.ts";

export interface ReadFormatContext<THost = undefined> {
  readonly digest: Digest | null;
  readonly limits: Readonly<ReadLimits>;
  /** "view" formats the body only, without notes. */
  readonly mode: "model" | "view";
  readonly call: ReadContext<THost>;
}

export interface ReadFormatter<THost = undefined> {
  readonly id: string;
  /** Sync and pure over the outcome. A string becomes one text part. */
  format(outcome: ReadReport, ctx: ReadFormatContext<THost>): string | readonly ContentPart[];
}
