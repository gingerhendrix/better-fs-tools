import type { ReadContext, ReadTool } from "../contract/context.ts";
import type { ReadToolDeps } from "../contract/deps.ts";
import type { ReadResult } from "../contract/result.ts";
import { resolveDependencies } from "./deps.ts";
import { isRecord } from "./input.ts";
import { runRead } from "./pipeline.ts";

/**
 * Validates and resolves dependencies once, synchronously. Throws TypeError on
 * an unknown key, a missing fs, an empty classifier list, or a malformed limit
 * or message.
 */
export function createReadTool<THost = undefined>(deps: ReadToolDeps<THost>): ReadTool<THost> {
  const resolved = resolveDependencies(deps);
  const read = async (input: unknown, ctx?: ReadContext<THost>): Promise<ReadResult> => {
    if (ctx !== undefined && !isRecord(ctx)) {
      throw new TypeError("read context must be an object");
    }
    // One call object for every stage of this read.
    const call = ctx ?? ({} as ReadContext<THost>);
    return runRead(resolved, input, call);
  };
  return read as ReadTool<THost>;
}
