import type { ToolCallContext } from "@better-fs-tools/read";

import type { BashInput } from "./input.ts";
import type { ShellResult } from "./result.ts";

/**
 * Same rule as the other tools: the context argument is optional, and `host`
 * may be left out, when THost includes undefined.
 */
export type BashTool<THost = undefined> = undefined extends THost
  ? (
      input: BashInput,
      ctx?: Omit<ToolCallContext<THost>, "host"> & { readonly host?: THost },
    ) => Promise<ShellResult>
  : (input: BashInput, ctx: ToolCallContext<THost>) => Promise<ShellResult>;
