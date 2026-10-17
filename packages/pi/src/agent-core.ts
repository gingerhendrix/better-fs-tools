/**
 * The Better FS Tools as AgentTool objects for @earendil-works/pi-agent-core:
 * an Agent's state.tools, or the tools of an agentLoop() context. This module
 * imports neither Node nor Pi at run time, so it runs in a browser or a
 * Worker with any writable filesystem.
 */
import { Type } from "typebox";
import type { TSchema } from "typebox";

import type { Clock, Digest, ToolCallContext } from "@better-fs-tools/read";
import { readToolDefinition } from "@better-fs-tools/read/signature";
import type {
  ReadSignature,
  ReadToolDefinition,
  ReadToolDefinitionOptions,
} from "@better-fs-tools/read/signature";
import { bashToolDefinition } from "@better-fs-tools/shell/signature";
import type {
  BashSignature,
  BashToolDefinition,
  BashToolDefinitionOptions,
} from "@better-fs-tools/shell/signature";
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
import {
  applyPatchToolDefinition,
  editToolDefinition,
  fsToolDefinitions,
  writeToolDefinition,
} from "@better-fs-tools/write/signature";
import type {
  ApplyPatchToolDefinitionOptions,
  EditSignature,
  EditToolDefinitionOptions,
  MutationToolDefinition,
  PatchSignature,
  WriteSignature,
  WriteToolDefinitionOptions,
} from "@better-fs-tools/write/signature";

import { toPiReadDetails, viewOf } from "./details.ts";
import type { PiReadDetails } from "./details.ts";
import { toPiMutationDetails } from "./mutation-details.ts";
import type { PiMutationDetails } from "./mutation-details.ts";
import { toPiPart } from "./parts.ts";
import type { PiContentPart } from "./parts.ts";
import { checkPiOptions } from "./prompt.ts";

/** An AgentTool host has no context object, so each call's host is undefined. */
type Host = undefined;

/** The result of an agent core tool. Assignable to AgentToolResult<TDetails>. */
export interface AgentCoreToolResult<TDetails> {
  content: PiContentPart[];
  details: TDetails;
  /** true for a tool error. bash also sets it for a nonzero exit and a timeout. */
  isError: boolean;
}

/** Assignable to AgentTool<TSchema, TDetails> from @earendil-works/pi-agent-core 1.x. */
export interface AgentCoreTool<TDetails> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  /** The JSON Schema of the tool input. */
  readonly parameters: TSchema;
  /** Set when the signature has a grammar. */
  readonly constrainedSampling?: { type: "grammar"; variants: { openai_lark: string } };
  /** "safe" on read: a rerun after a crash changes nothing. */
  readonly replay?: "never" | "safe";
  /** Model input is checked with the signature: bad input throws TypeError. */
  readonly execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
  ) => Promise<AgentCoreToolResult<TDetails>>;
}

export type AgentCoreReadTool = AgentCoreTool<PiReadDetails>;
export type AgentCoreMutationTool = AgentCoreTool<PiMutationDetails | undefined>;
export type AgentCoreBashTool = AgentCoreTool<{ fullOutputPath?: string } | undefined>;

/** Options for createAgentCoreReadTool: the options of readToolDefinition(). `fs` is required. */
export type AgentCoreReadToolOptions = ReadToolDefinitionOptions<Host>;
/** Options for createAgentCoreEditTool: the options of editToolDefinition(). */
export type AgentCoreEditToolOptions = EditToolDefinitionOptions<Host>;
/** Options for createAgentCoreWriteTool: the options of writeToolDefinition(). */
export type AgentCoreWriteToolOptions = WriteToolDefinitionOptions<Host>;
/** Options for createAgentCoreApplyPatchTool: the options of applyPatchToolDefinition(). */
export type AgentCoreApplyPatchToolOptions = ApplyPatchToolDefinitionOptions<Host>;
/** Options for createAgentCoreBashTool: the options of bashToolDefinition(). `runner` and `env` are required. */
export type AgentCoreBashToolOptions = BashToolDefinitionOptions<Host>;

/** Read options of the bundle. Shared keys are set once at the top level. */
export type AgentCoreFsToolsReadOptions = FsToolsReadOptions<Host> & {
  /** Default defaultReadSignature(). */
  readonly signature?: ReadSignature;
};
export type AgentCoreFsToolsEditOptions = FsToolsEditOptions<Host> & {
  /** Default defaultEditSignature({ matchers }). */
  readonly signature?: EditSignature;
};
export type AgentCoreFsToolsWriteOptions = FsToolsWriteOptions<Host> & {
  /** Default defaultWriteSignature(). */
  readonly signature?: WriteSignature;
};
export type AgentCoreFsToolsApplyPatchOptions = FsToolsApplyPatchOptions<Host> & {
  /** Default defaultPatchSignature(). */
  readonly signature?: PatchSignature;
};
/** bash options of the bundle. `runner` and `env` are required. */
export type AgentCoreFsToolsBashOptions = FsToolsBashOptions<Host> & {
  /** Default defaultBashSignature() for the runner's id and the limits. */
  readonly signature?: BashSignature;
};

/** The options of createFsTools(), with a `signature` in each tool's options. */
export interface AgentCoreFsToolsOptions extends Omit<
  FsToolsOptions<Host>,
  "read" | "edit" | "write" | "applyPatch" | "bash"
> {
  readonly read?: AgentCoreFsToolsReadOptions;
  readonly edit?: AgentCoreFsToolsEditOptions;
  readonly write?: AgentCoreFsToolsWriteOptions;
  /** Off by default. `true` or an options object adds an apply_patch tool. */
  readonly applyPatch?: boolean | AgentCoreFsToolsApplyPatchOptions;
  /** Off by default. pi-agent-core has no tools of its own: give a runner and an env for bash. */
  readonly bash?: false | AgentCoreFsToolsBashOptions;
}

export interface AgentCoreFsTools {
  readonly read: AgentCoreReadTool;
  readonly edit: AgentCoreMutationTool;
  readonly write: AgentCoreMutationTool;
  /** null unless options.applyPatch is true or an object. */
  readonly applyPatch: AgentCoreMutationTool | null;
  /** null unless options.bash is set. */
  readonly bash: AgentCoreBashTool | null;
  /** Every tool of the bundle, for agent.state.tools or an agentLoop() context. */
  readonly tools: readonly (AgentCoreReadTool | AgentCoreMutationTool | AgentCoreBashTool)[];
  readonly state: FsToolsState<Host>;
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /** As createFsTools().invalidate. When fs or state is a factory, pass the call context. */
  invalidate(path: string, call?: ToolCallContext<Host>): Promise<InvalidateOutcome>;
}

/** The createAgentCoreFsTools result when `applyPatch` is true or an object: it is never null. */
export interface AgentCoreFsToolsWithApplyPatch extends AgentCoreFsTools {
  readonly applyPatch: AgentCoreMutationTool;
}

/** The createAgentCoreFsTools result when `bash` is set: it is never null. */
export interface AgentCoreFsToolsWithBash extends AgentCoreFsTools {
  readonly bash: AgentCoreBashTool;
}

/** Creates a read AgentTool with the options and defaults of createReadTool(). read is replay-safe. */
export function createAgentCoreReadTool(options: AgentCoreReadToolOptions): AgentCoreReadTool {
  checkPiOptions(options, "agent core read tool");
  return adaptReadTool(readToolDefinition<Host>(options));
}

/** Creates an edit AgentTool with the options and defaults of createEditTool(). */
export function createAgentCoreEditTool(options: AgentCoreEditToolOptions): AgentCoreMutationTool {
  checkPiOptions(options, "agent core edit tool");
  return adaptMutationTool("edit", editToolDefinition<Host>(options));
}

/** Creates a write AgentTool with the options and defaults of createWriteTool(). */
export function createAgentCoreWriteTool(
  options: AgentCoreWriteToolOptions,
): AgentCoreMutationTool {
  checkPiOptions(options, "agent core write tool");
  return adaptMutationTool("write", writeToolDefinition<Host>(options));
}

/** Creates an apply_patch AgentTool with the options and defaults of createApplyPatchTool(). */
export function createAgentCoreApplyPatchTool(
  options: AgentCoreApplyPatchToolOptions,
): AgentCoreMutationTool {
  checkPiOptions(options, "agent core apply_patch tool");
  return adaptMutationTool("apply_patch", applyPatchToolDefinition<Host>(options));
}

/** Creates a bash AgentTool with the options and defaults of createBashTool(). */
export function createAgentCoreBashTool(options: AgentCoreBashToolOptions): AgentCoreBashTool {
  checkPiOptions(options, "agent core bash tool");
  return adaptBashTool(bashToolDefinition<Host>(options));
}

/**
 * Creates read, edit, and write AgentTools over one writable filesystem, with
 * one digest, lock manager, and clock, and the read state when `state` is
 * given. With `applyPatch`, also apply_patch. With `bash`, also bash. Every
 * option and default is the one of createFsTools().
 *
 * A tool error is a result with `isError: true`, not a throw. Bad model input
 * throws TypeError. Throws TypeError where createFsTools() does, with
 * createAgentCoreFsTools in the message.
 */
export function createAgentCoreFsTools(
  options: AgentCoreFsToolsOptions & {
    readonly applyPatch: true | AgentCoreFsToolsApplyPatchOptions;
    readonly bash: AgentCoreFsToolsBashOptions;
  },
): AgentCoreFsToolsWithApplyPatch & AgentCoreFsToolsWithBash;
export function createAgentCoreFsTools(
  options: AgentCoreFsToolsOptions & { readonly bash: AgentCoreFsToolsBashOptions },
): AgentCoreFsToolsWithBash;
export function createAgentCoreFsTools(
  options: AgentCoreFsToolsOptions & {
    readonly applyPatch: true | AgentCoreFsToolsApplyPatchOptions;
  },
): AgentCoreFsToolsWithApplyPatch;
export function createAgentCoreFsTools(options: AgentCoreFsToolsOptions): AgentCoreFsTools;
export function createAgentCoreFsTools(options: AgentCoreFsToolsOptions): AgentCoreFsTools {
  checkPiOptions(options, "createAgentCoreFsTools");
  const defs = fsToolDefinitions<Host>(options, "createAgentCoreFsTools");
  const adapted = {
    read: adaptReadTool(defs.read),
    edit: adaptMutationTool("edit", defs.edit),
    write: adaptMutationTool("write", defs.write),
    applyPatch: defs.applyPatch === null ? null : adaptMutationTool("apply_patch", defs.applyPatch),
    bash: defs.bash === null ? null : adaptBashTool(defs.bash),
  };
  return Object.freeze<AgentCoreFsTools>({
    ...adapted,
    tools: Object.freeze(Object.values(adapted).filter((tool) => tool !== null)),
    state: defs.state,
    digest: defs.digest,
    locks: defs.locks,
    clock: defs.clock,
    invalidate: defs.invalidate,
  });
}

function declaration(definition: {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly grammar?: { readonly lark: string };
}) {
  return {
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: Type.Unsafe(definition.inputSchema),
    ...(definition.grammar === undefined
      ? {}
      : {
          constrainedSampling: {
            type: "grammar" as const,
            variants: { openai_lark: definition.grammar.lark },
          },
        }),
  };
}

function callOf(toolCallId: string, signal: AbortSignal | undefined): ToolCallContext<Host> {
  return { ...(signal === undefined ? {} : { signal }), callId: toolCallId, host: undefined };
}

function adaptReadTool(definition: ReadToolDefinition<Host>): AgentCoreReadTool {
  const { limits, formatter, digest } = definition;
  return Object.freeze<AgentCoreReadTool>({
    ...declaration(definition),
    replay: "safe",
    async execute(toolCallId, params, signal) {
      const call = callOf(toolCallId, signal);
      const result = await definition.execute(params, call);
      const content = result.content.map((part) => toPiPart(part, "read"));
      const view = viewOf(formatter, result, { digest, limits, mode: "view", call });
      const details = toPiReadDetails(result, view, limits.maxViewBytes);
      return { content, details, isError: result.status === "error" };
    },
  });
}

function adaptMutationTool<TInput>(
  kind: "edit" | "write" | "apply_patch",
  definition: MutationToolDefinition<TInput, Host>,
): AgentCoreMutationTool {
  return Object.freeze<AgentCoreMutationTool>({
    ...declaration(definition),
    async execute(toolCallId, params, signal) {
      const result = await definition.execute(params, callOf(toolCallId, signal));
      return {
        content: result.content.map((part) => toPiPart(part, kind)),
        // The coding agent's own write has no details.
        details: kind === "write" ? undefined : toPiMutationDetails(result),
        isError: result.status === "error",
      };
    },
  });
}

function adaptBashTool(definition: BashToolDefinition<Host>): AgentCoreBashTool {
  return Object.freeze<AgentCoreBashTool>({
    ...declaration(definition),
    async execute(toolCallId, params, signal) {
      const result = await definition.execute(params, callOf(toolCallId, signal));
      const spill = result.output?.spill ?? null;
      return {
        content: result.content.map((part) => toPiPart(part, "bash")),
        details: spill === null ? undefined : { fullOutputPath: spill },
        isError: result.status !== "ok",
      };
    },
  });
}
