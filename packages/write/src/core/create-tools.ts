import type { ToolCallContext } from "@better-fs-tools/read";

import type { WriteTool } from "../contract/context.ts";
import type { WriteToolDeps } from "../contract/deps.ts";
import type { MutationResult } from "../contract/result.ts";
import { resolveWriteDependencies } from "./deps.ts";
import { isRecord } from "./input.ts";
import { runWrite } from "./pipeline.ts";

/**
 * Validates and resolves dependencies once, synchronously. Throws TypeError
 * on an unknown key, a missing fs, an empty classifier or codec list, state
 * without digest, or a malformed limit, message, or policy. limits, messages,
 * and preconditions merge key by key. Every other dependency replaces.
 */
export function createWriteTool<THost = undefined>(deps: WriteToolDeps<THost>): WriteTool<THost> {
  const resolved = resolveWriteDependencies(deps, "write");
  const write = async (input: unknown, ctx?: ToolCallContext<THost>): Promise<MutationResult> => {
    if (ctx !== undefined && !isRecord(ctx)) throw new TypeError("write context must be an object");
    // One call object for every stage of this call.
    const call = ctx ?? ({} as ToolCallContext<THost>);
    return runWrite(resolved, input, call);
  };
  return write as WriteTool<THost>;
}
