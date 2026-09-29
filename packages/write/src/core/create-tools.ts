import type { ToolCallContext } from "@better-fs-tools/read";

import type { ApplyPatchTool, EditTool, WriteTool } from "../contract/context.ts";
import type { StateNeedsDigest } from "@better-fs-tools/read";

import type { ApplyPatchToolDeps, EditToolDeps, WriteToolDeps } from "../contract/deps.ts";
import type { MutationResult } from "../contract/result.ts";
import {
  resolveApplyPatchDependencies,
  resolveEditDependencies,
  resolveWriteDependencies,
} from "./deps.ts";
import { MissCounter } from "./hints.ts";
import { isRecord } from "./input.ts";
import { runApplyPatch } from "./patch-pipeline.ts";
import { runEdit, runWrite } from "./pipeline.ts";

/**
 * Creates the edit tool. Takes the same dependencies as createWriteTool, plus
 * a non-empty `matchers` list (default defaultEditMatchers()). Throws
 * TypeError on invalid dependencies.
 */
export function createEditTool<THost = undefined>(
  deps: EditToolDeps<THost> & StateNeedsDigest,
): EditTool<THost> {
  const resolved = resolveEditDependencies(deps);
  const misses = new MissCounter();
  const edit = async (input: unknown, ctx?: ToolCallContext<THost>): Promise<MutationResult> => {
    if (ctx !== undefined && !isRecord(ctx)) throw new TypeError("edit context must be an object");
    const call = ctx ?? ({} as ToolCallContext<THost>);
    return runEdit(resolved, input, call, misses);
  };
  return edit as EditTool<THost>;
}

/**
 * Creates the write tool. Throws TypeError on an unknown key, a missing fs,
 * an empty classifier or codec list, state without digest, or a malformed
 * limit, message, or policy. limits, messages, and preconditions merge with
 * the defaults key by key. Every other dependency replaces its default.
 */
export function createWriteTool<THost = undefined>(
  deps: WriteToolDeps<THost> & StateNeedsDigest,
): WriteTool<THost> {
  const resolved = resolveWriteDependencies(deps, "write");
  const write = async (input: unknown, ctx?: ToolCallContext<THost>): Promise<MutationResult> => {
    if (ctx !== undefined && !isRecord(ctx)) throw new TypeError("write context must be an object");
    const call = ctx ?? ({} as ToolCallContext<THost>);
    return runWrite(resolved, input, call);
  };
  return write as WriteTool<THost>;
}

/**
 * Creates the apply_patch tool. Takes the same dependencies as
 * createWriteTool, plus a non-empty `matchers` list (default
 * defaultPatchMatchers()) and a `patchParser` (default codexPatchParser()).
 * Throws TypeError on invalid dependencies.
 */
export function createApplyPatchTool<THost = undefined>(
  deps: ApplyPatchToolDeps<THost> & StateNeedsDigest,
): ApplyPatchTool<THost> {
  const resolved = resolveApplyPatchDependencies(deps);
  const applyPatch = async (
    input: unknown,
    ctx?: ToolCallContext<THost>,
  ): Promise<MutationResult> => {
    if (ctx !== undefined && !isRecord(ctx)) {
      throw new TypeError("apply_patch context must be an object");
    }
    const call = ctx ?? ({} as ToolCallContext<THost>);
    return runApplyPatch(resolved, input, call);
  };
  return applyPatch as ApplyPatchTool<THost>;
}
