import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { Clock, Digest, ToolCallContext } from "@better-fs-tools/read";
import type { ReadSignature } from "@better-fs-tools/read/signature";
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
} from "@better-fs-tools/write";
import { fsToolDefinitions } from "@better-fs-tools/write/signature";
import type {
  EditSignature,
  PatchSignature,
  WriteSignature,
} from "@better-fs-tools/write/signature";

import { adaptPiBashTool } from "./bash-tool.ts";
import type { PiBashTool } from "./bash-tool.ts";
import { adaptPiMutationTool } from "./mutation-tools.ts";
import type { PiMutationTool } from "./mutation-tools.ts";
import { checkPiOptions, splitPrompt } from "./prompt.ts";
import type { PiPromptOptions } from "./prompt.ts";
import { adaptPiReadTool } from "./tool.ts";
import type { PiReadTool } from "./tool.ts";

type Host = ExtensionContext;

/** Read tool options for createPiFsTools. Shared keys are set once at the top level. */
export type PiFsToolsReadOptions = FsToolsReadOptions<Host> &
  PiPromptOptions & {
    /** Default defaultReadSignature(). */
    readonly signature?: ReadSignature;
  };
export type PiFsToolsEditOptions = FsToolsEditOptions<Host> &
  PiPromptOptions & {
    /** Default defaultEditSignature() for `matchers`. */
    readonly signature?: EditSignature;
  };
export type PiFsToolsWriteOptions = FsToolsWriteOptions<Host> &
  PiPromptOptions & {
    /** Default defaultWriteSignature(). */
    readonly signature?: WriteSignature;
  };
export type PiFsToolsApplyPatchOptions = FsToolsApplyPatchOptions<Host> &
  PiPromptOptions & {
    /** Default defaultPatchSignature(). */
    readonly signature?: PatchSignature;
  };
/** Bash tool options for createPiFsTools. `runner` and `env` are required. */
export type PiFsToolsBashOptions = FsToolsBashOptions<Host> &
  PiPromptOptions & {
    /** Default defaultBashSignature() for the runner's id and the limits. */
    readonly signature?: BashSignature;
  };

/**
 * The options of createFsTools(), with the Pi extension context as host, and
 * a `signature` and the Pi prompt options in each tool's options.
 */
export interface PiFsToolsOptions extends Omit<
  FsToolsOptions<Host>,
  "read" | "edit" | "write" | "applyPatch" | "bash"
> {
  readonly read?: PiFsToolsReadOptions;
  readonly edit?: PiFsToolsEditOptions;
  readonly write?: PiFsToolsWriteOptions;
  /** Off by default. `true` or an options object adds an apply_patch tool. */
  readonly applyPatch?: boolean | PiFsToolsApplyPatchOptions;
  /** Off by default. Give a runner and an env to add a bash tool. */
  readonly bash?: false | PiFsToolsBashOptions;
}

export interface PiFsTools {
  readonly read: PiReadTool;
  readonly edit: PiMutationTool;
  readonly write: PiMutationTool;
  /** null unless options.applyPatch is true or an object. */
  readonly applyPatch: PiMutationTool | null;
  /** null unless options.bash is set. */
  readonly bash: PiBashTool | null;
  readonly state: FsToolsState<Host>;
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /**
   * Forgets the read record for a path, so the next edit needs a read. Pass the
   * call when fs or state is a factory; in a bash afterRun hook it is ctx.call.
   * Never throws.
   */
  invalidate(path: string, call?: ToolCallContext<Host>): Promise<InvalidateOutcome>;
}

/** The createPiFsTools result when `applyPatch` is true or an object: it is never null. */
export interface PiFsToolsWithApplyPatch extends PiFsTools {
  readonly applyPatch: PiMutationTool;
}

/** The createPiFsTools result when `bash` is set: it is never null. */
export interface PiFsToolsWithBash extends PiFsTools {
  readonly bash: PiBashTool;
}

/**
 * Creates Pi read, edit, and write tools over one filesystem, sharing one
 * digest, lock manager, and clock, and the read state when `state` is given.
 * With `applyPatch`, also apply_patch. With `bash`, also bash, with the same
 * digest and clock. Every option and default is the one of createFsTools().
 * Throws TypeError where createFsTools() does, with createPiFsTools in the
 * message.
 */
export function createPiFsTools(
  options: PiFsToolsOptions & {
    readonly applyPatch: true | PiFsToolsApplyPatchOptions;
    readonly bash: PiFsToolsBashOptions;
  },
): PiFsToolsWithApplyPatch & PiFsToolsWithBash;
export function createPiFsTools(
  options: PiFsToolsOptions & { readonly bash: PiFsToolsBashOptions },
): PiFsToolsWithBash;
export function createPiFsTools(
  options: PiFsToolsOptions & { readonly applyPatch: true | PiFsToolsApplyPatchOptions },
): PiFsToolsWithApplyPatch;
export function createPiFsTools(options: PiFsToolsOptions): PiFsTools;
export function createPiFsTools(options: PiFsToolsOptions): PiFsTools {
  checkPiOptions(options, "createPiFsTools");
  const read = splitPrompt(options.read ?? {});
  const edit = splitPrompt(options.edit ?? {});
  const write = splitPrompt(options.write ?? {});
  const applyPatch = isObject(options.applyPatch) ? splitPrompt(options.applyPatch) : null;
  const bash = isObject(options.bash) ? splitPrompt(options.bash) : null;
  const defs = fsToolDefinitions<Host>(
    {
      ...options,
      ...(options.read === undefined ? {} : { read: read.rest }),
      ...(options.edit === undefined ? {} : { edit: edit.rest }),
      ...(options.write === undefined ? {} : { write: write.rest }),
      ...(applyPatch === null ? {} : { applyPatch: applyPatch.rest }),
      ...(bash === null ? {} : { bash: bash.rest }),
    },
    "createPiFsTools",
  );
  return Object.freeze<PiFsTools>({
    read: adaptPiReadTool(defs.read, read.prompt),
    edit: adaptPiMutationTool("edit", defs.edit, edit.prompt),
    write: adaptPiMutationTool("write", defs.write, write.prompt),
    applyPatch:
      defs.applyPatch === null
        ? null
        : adaptPiMutationTool("apply_patch", defs.applyPatch, applyPatch?.prompt ?? {}),
    bash: defs.bash === null ? null : adaptPiBashTool(defs.bash, bash?.prompt ?? {}),
    state: defs.state,
    digest: defs.digest,
    locks: defs.locks,
    clock: defs.clock,
    invalidate: defs.invalidate,
  });
}

function isObject<T>(value: T | boolean | undefined): value is T & object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
