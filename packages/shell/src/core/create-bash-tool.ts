import type { ToolCallContext } from "@better-fs-tools/read";

import type { BashTool } from "../contract/context.ts";
import type { ShellToolDeps } from "../contract/deps.ts";
import type { ShellResult } from "../contract/result.ts";
import { resolveShellDependencies } from "./deps.ts";
import { isRecord } from "./input.ts";
import { runBash } from "./pipeline.ts";

/**
 * Validates and resolves dependencies once, synchronously. Throws TypeError
 * on an unknown key, a missing runner, or a malformed dependency. `limits`
 * and `messages` merge key by key. Every other dependency replaces.
 */
export function createBashTool<THost = undefined>(deps: ShellToolDeps<THost>): BashTool<THost> {
  const resolved = resolveShellDependencies(deps);
  const bash = async (input: unknown, ctx?: ToolCallContext<THost>): Promise<ShellResult> => {
    if (ctx !== undefined && !isRecord(ctx)) throw new TypeError("bash context must be an object");
    // One call object for every stage of this call.
    const call = ctx ?? ({} as ToolCallContext<THost>);
    return runBash(resolved, input, call);
  };
  return bash as BashTool<THost>;
}
