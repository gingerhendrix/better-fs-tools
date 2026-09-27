import type { ToolCallContext } from "./base.ts";
import type { ReadInput } from "./input.ts";
import type { ReadResult } from "./result.ts";

/**
 * Built by the adapter for each tool call. The core passes it by reference to
 * every stage and never reads `host`. A direct caller with no host leaves
 * `host` out; see ReadTool.
 */
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
