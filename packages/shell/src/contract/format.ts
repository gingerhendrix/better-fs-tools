import type { ContentPart, Digest, ToolCallContext } from "@better-fs-tools/read";

import type { ShellLimits } from "./limits.ts";
import type { ShellMessageCatalog } from "./messages.ts";
import type { ShellReport } from "./result.ts";

export interface ShellFormatContext<THost = undefined> {
  /** The tool's digest dependency. */
  readonly digest: Digest | null;
  readonly limits: Readonly<ShellLimits>;
  readonly messages: Readonly<ShellMessageCatalog>;
  /** "view": status line and output only, no notes. */
  readonly mode: "model" | "view";
  readonly call: ToolCallContext<THost>;
}

export interface ShellFormatter<THost = undefined> {
  readonly id: string;
  /**
   * Sync and pure. A string becomes one text part. After a throw, or a return
   * that is neither a string nor an array, the default formatter formats the
   * report with no added note. The status stays.
   */
  format(report: ShellReport, ctx: ShellFormatContext<THost>): string | readonly ContentPart[];
}
