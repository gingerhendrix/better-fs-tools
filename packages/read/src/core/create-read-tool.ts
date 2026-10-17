import type { ReadContext, ReadTool } from "../contract/context.ts";
import type { ReadToolOptions, StateNeedsDigest } from "../contract/deps.ts";
import type { ReadResult } from "../contract/result.ts";
import { resolveDependencies } from "./deps.ts";
import { isRecord } from "./input.ts";
import { runRead } from "./pipeline.ts";

/**
 * Creates the read tool. Throws TypeError on an unknown or malformed option,
 * a missing `fs`, an empty `classifiers` list, or a `state` without a `digest`.
 */
export function createReadTool<THost = undefined>(
  options: ReadToolOptions<THost> & StateNeedsDigest,
): ReadTool<THost> {
  const resolved = resolveDependencies(options);
  const read = async (input: unknown, ctx?: ReadContext<THost>): Promise<ReadResult> => {
    if (ctx !== undefined && !isRecord(ctx)) {
      throw new TypeError("read context must be an object");
    }
    const call = ctx ?? ({} as ReadContext<THost>);
    return runRead(resolved, input, call);
  };
  return read as ReadTool<THost>;
}
