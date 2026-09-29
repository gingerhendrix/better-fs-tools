import type { ContentPart, Digest, ToolCallContext } from "@better-fs-tools/read";

import type { WriteLimits } from "./limits.ts";
import type { MutationReport } from "./result.ts";

export interface WriteFormatContext<THost = undefined> {
  readonly digest: Digest | null;
  readonly limits: Readonly<WriteLimits>;
  /** "view": body only, no notes. */
  readonly mode: "model" | "view";
  readonly call: ToolCallContext<THost>;
}

export interface WriteFormatter<THost = undefined> {
  readonly id: string;
  /** Sync and pure. A string becomes one text part. If it throws, the default format is used with a warning. */
  format(report: MutationReport, ctx: WriteFormatContext<THost>): string | readonly ContentPart[];
}
