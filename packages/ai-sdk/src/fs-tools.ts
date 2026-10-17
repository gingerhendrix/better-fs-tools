import type { FlexibleSchema, ToolExecutionOptions } from "ai";

import type { Clock, Digest, ReadResult, ToolCallContext } from "@better-fs-tools/read";
import type { ReadSignature } from "@better-fs-tools/read/signature";
import type { ShellResult } from "@better-fs-tools/shell";
import type { BashSignature } from "@better-fs-tools/shell/signature";
import type {
  FsToolsApplyPatchOptions,
  FsToolsBashOptions,
  FsToolsEditOptions,
  FsToolsOptions,
  FsToolsReadOptions,
  FsToolsState,
  FsToolsWriteOptions,
  InvalidateOutcome,
  LockManager,
  MutationResult,
} from "@better-fs-tools/write";
import { fsToolDefinitions } from "@better-fs-tools/write/signature";
import type {
  EditSignature,
  PatchSignature,
  WriteSignature,
} from "@better-fs-tools/write/signature";

import { adaptAiSdkTool, checkOptions } from "./adapt.ts";
import type { AiSdkBashTool } from "./bash-tool.ts";
import type { AiSdkMutationTool } from "./mutation-tools.ts";
import type { AiSdkReadTool } from "./tool.ts";

type Host<C> = ToolExecutionOptions<C>;

/** Read tool options for createAiSdkFsTools. Shared keys are set once at the top level. */
export type AiSdkFsToolsReadOptions<C = unknown> = FsToolsReadOptions<Host<C>> & {
  /** Defaults to defaultReadSignature(). */
  readonly signature?: ReadSignature;
};
export type AiSdkFsToolsEditOptions<C = unknown> = FsToolsEditOptions<Host<C>> & {
  /** Defaults to defaultEditSignature() for `matchers`. */
  readonly signature?: EditSignature;
};
export type AiSdkFsToolsWriteOptions<C = unknown> = FsToolsWriteOptions<Host<C>> & {
  /** Defaults to defaultWriteSignature(). */
  readonly signature?: WriteSignature;
};
export type AiSdkFsToolsApplyPatchOptions<C = unknown> = FsToolsApplyPatchOptions<Host<C>> & {
  /** Defaults to defaultPatchSignature(). */
  readonly signature?: PatchSignature;
};
/** Bash tool options for createAiSdkFsTools. `runner` and `env` are required. */
export type AiSdkFsToolsBashOptions<C = unknown> = FsToolsBashOptions<Host<C>> & {
  /** Defaults to defaultBashSignature() for the runner's id and the limits. */
  readonly signature?: BashSignature;
};

/** The options of createFsTools(), with a `signature` in each tool's options, plus `contextSchema`. */
export interface AiSdkFsToolsOptions<C = unknown> extends Omit<
  FsToolsOptions<Host<C>>,
  "read" | "edit" | "write" | "applyPatch" | "bash"
> {
  /**
   * Checks the `toolsContext` entry of each tool. The AI SDK validates the
   * context with it before `execute`. Every tool of the bundle gets the same schema.
   */
  readonly contextSchema?: FlexibleSchema<C>;
  readonly read?: AiSdkFsToolsReadOptions<C>;
  readonly edit?: AiSdkFsToolsEditOptions<C>;
  readonly write?: AiSdkFsToolsWriteOptions<C>;
  /** Off by default. `true` or an options object adds an apply_patch tool. */
  readonly applyPatch?: boolean | AiSdkFsToolsApplyPatchOptions<C>;
  /** Off by default. This package starts no process: give a runner and an env to turn bash on. */
  readonly bash?: false | AiSdkFsToolsBashOptions<C>;
}

export interface AiSdkFsTools<C = unknown> {
  readonly read: AiSdkReadTool<C>;
  readonly edit: AiSdkMutationTool<C>;
  readonly write: AiSdkMutationTool<C>;
  /** null unless options.applyPatch is true or an object. */
  readonly applyPatch: AiSdkMutationTool<C> | null;
  /** null unless options.bash is set. */
  readonly bash: AiSdkBashTool<C> | null;
  /** Every tool of the bundle keyed by its name, ready for generateText({ tools }). */
  readonly tools: Readonly<
    Record<string, AiSdkReadTool<C> | AiSdkMutationTool<C> | AiSdkBashTool<C>>
  >;
  readonly state: FsToolsState<Host<C>>;
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /** Same as createFsTools().invalidate. When fs or state is a factory, pass the call context. */
  invalidate(path: string, call?: ToolCallContext<Host<C>>): Promise<InvalidateOutcome>;
}

/** The createAiSdkFsTools result when `bash` is set: `bash` is never null. */
export interface AiSdkFsToolsWithBash<C = unknown> extends AiSdkFsTools<C> {
  readonly bash: AiSdkBashTool<C>;
}

/** The createAiSdkFsTools result when `applyPatch` is true or an object: it is never null. */
export interface AiSdkFsToolsWithApplyPatch<C = unknown> extends AiSdkFsTools<C> {
  readonly applyPatch: AiSdkMutationTool<C>;
}

/**
 * Creates AI SDK read, edit, and write tools over one backend, sharing one
 * digest, lock manager, and clock, and the read store when `state` is given.
 * read returns an image as a file part unless `read.converters` is set.
 * Needs no Node module, so it runs in a Worker. With `applyPatch`, also
 * creates an apply_patch tool. With `bash`, also creates a bash tool with the
 * same digest and clock.
 *
 * Throws TypeError on an unknown option key, and on a shared key (fs, state,
 * digest, locks, clock) inside a tool's options.
 */
export function createAiSdkFsTools<C = unknown>(
  options: AiSdkFsToolsOptions<C> & {
    readonly bash: AiSdkFsToolsBashOptions<C>;
    readonly applyPatch: true | AiSdkFsToolsApplyPatchOptions<C>;
  },
): AiSdkFsToolsWithBash<C> & AiSdkFsToolsWithApplyPatch<C>;
export function createAiSdkFsTools<C = unknown>(
  options: AiSdkFsToolsOptions<C> & { readonly bash: AiSdkFsToolsBashOptions<C> },
): AiSdkFsToolsWithBash<C>;
export function createAiSdkFsTools<C = unknown>(
  options: AiSdkFsToolsOptions<C> & {
    readonly applyPatch: true | AiSdkFsToolsApplyPatchOptions<C>;
  },
): AiSdkFsToolsWithApplyPatch<C>;
export function createAiSdkFsTools<C = unknown>(options: AiSdkFsToolsOptions<C>): AiSdkFsTools<C>;
export function createAiSdkFsTools<C = unknown>(options: AiSdkFsToolsOptions<C>): AiSdkFsTools<C> {
  checkOptions(options, "createAiSdkFsTools");
  const { contextSchema, ...rest } = options;
  const defs = fsToolDefinitions<Host<C>>(rest, "createAiSdkFsTools");
  const adapted = {
    read: adaptAiSdkTool<ReadResult, C>(defs.read, contextSchema),
    edit: adaptAiSdkTool<MutationResult, C>(defs.edit, contextSchema),
    write: adaptAiSdkTool<MutationResult, C>(defs.write, contextSchema),
    applyPatch:
      defs.applyPatch === null
        ? null
        : adaptAiSdkTool<MutationResult, C>(defs.applyPatch, contextSchema),
    bash: defs.bash === null ? null : adaptAiSdkTool<ShellResult, C>(defs.bash, contextSchema),
  };
  const tools: Record<string, AiSdkReadTool<C> | AiSdkMutationTool<C> | AiSdkBashTool<C>> = {};
  for (const tool of Object.values(adapted)) {
    if (tool !== null) tools[tool.name] = tool;
  }
  return Object.freeze<AiSdkFsTools<C>>({
    ...adapted,
    tools: Object.freeze(tools),
    state: defs.state,
    digest: defs.digest,
    locks: defs.locks,
    clock: defs.clock,
    invalidate: defs.invalidate,
  });
}
