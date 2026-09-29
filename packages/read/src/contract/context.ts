import type { ToolCallContext } from "./base.ts";
import type { ReadInput } from "./input.ts";
import type { ReadResult } from "./result.ts";

/** Per-call context for the read tool. The tool passes `host` through to extensions and never reads it. */
export interface ReadContext<THost = undefined> extends ToolCallContext<THost> {}

/**
 * The context argument is optional, and `host` may be left out, when THost
 * includes undefined. Otherwise both are required.
 */
export type ReadTool<THost = undefined> = undefined extends THost
  ? (
      input: ReadInput,
      ctx?: Omit<ReadContext<THost>, "host"> & { readonly host?: THost },
    ) => Promise<ReadResult>
  : (input: ReadInput, ctx: ReadContext<THost>) => Promise<ReadResult>;
