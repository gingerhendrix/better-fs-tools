import type { ContentPart, ToolCallContext } from "@better-fs-tools/read";

import type { ShellLimits } from "./limits.ts";
import type { ShellMessageCatalog } from "./messages.ts";
import type { ShellReport } from "./result.ts";

export interface ShellFormatContext<THost = undefined> {
  readonly limits: Readonly<ShellLimits>;
  readonly messages: Readonly<ShellMessageCatalog>;
  /** "view": status line and output only, no notes. */
  readonly mode: "model" | "view";
  readonly call: ToolCallContext<THost>;
}

export interface ShellFormatter<THost = undefined> {
  readonly id: string;
  /** Sync and pure. A string becomes one text part. A throw gives EXTENSION_FAILED. */
  format(report: ShellReport, ctx: ShellFormatContext<THost>): string | readonly ContentPart[];
}
