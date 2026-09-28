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
  /**
   * Sync and pure. A string becomes one text part. A throw, or a return that
   * is neither a string nor an array, adds an extension-failed warning, and the
   * default formatter formats the report. The status stays.
   */
  format(report: ShellReport, ctx: ShellFormatContext<THost>): string | readonly ContentPart[];
}
