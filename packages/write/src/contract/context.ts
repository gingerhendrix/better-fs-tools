import type { ToolCallContext } from "@better-fs-tools/read";

import type { ApplyPatchInput, EditInput, WriteInput } from "./input.ts";
import type { MutationResult } from "./result.ts";

export type WriteToolName = "edit" | "write" | "apply_patch";

/**
 * Same rule as ReadTool: the context argument is optional, and `host` may be
 * left out, when THost includes undefined. Otherwise both are required.
 */
export type MutationTool<TInput, THost = undefined> = undefined extends THost
  ? (
      input: TInput,
      ctx?: Omit<ToolCallContext<THost>, "host"> & { readonly host?: THost },
    ) => Promise<MutationResult>
  : (input: TInput, ctx: ToolCallContext<THost>) => Promise<MutationResult>;

export type EditTool<THost = undefined> = MutationTool<EditInput, THost>;
export type WriteTool<THost = undefined> = MutationTool<WriteInput, THost>;
export type ApplyPatchTool<THost = undefined> = MutationTool<ApplyPatchInput, THost>;
