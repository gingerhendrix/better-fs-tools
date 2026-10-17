/**
 * The Better FS Tools as AgentTool objects for @earendil-works/pi-agent-core:
 * an Agent's state.tools, or the tools of an agentLoop() context. This module
 * imports neither Node nor Pi at run time, so it runs in a browser or a
 * Worker with any writable filesystem.
 */
import { Type } from "typebox";
import type { TSchema } from "typebox";

import { imageConverter, lineNumberFormatter, resolveReadLimits } from "@better-fs-tools/read";
import type {
  Clock,
  Digest,
  ReadStateStore,
  ReadToolOptions,
  ToolCallContext,
} from "@better-fs-tools/read";
import { defaultReadSignature, readSignatureMessages } from "@better-fs-tools/read/signature";
import type { ReadSignature } from "@better-fs-tools/read/signature";
import type { ShellResult } from "@better-fs-tools/shell";
import { bashSignatureMessages, defaultBashSignature } from "@better-fs-tools/shell/signature";
import type { BashSignature } from "@better-fs-tools/shell/signature";
import { createFsTools } from "@better-fs-tools/write";
import type {
  ApplyPatchToolOptions,
  FsToolsOptions,
  EditToolOptions,
  FsToolsBashOptions,
  FsToolsSharedKey,
  InvalidateOutcome,
  LockManager,
  MutationResult,
  WriteToolOptions,
} from "@better-fs-tools/write";
import {
  defaultEditSignature,
  defaultPatchSignature,
  defaultWriteSignature,
  writeSignatureMessages,
} from "@better-fs-tools/write/signature";
import type {
  EditSignature,
  MutationSignature,
  PatchSignature,
  WriteSignature,
} from "@better-fs-tools/write/signature";

import { toPiReadDetails, viewOf } from "./details.ts";
import type { PiReadDetails } from "./details.ts";
import { toPiMutationDetails } from "./mutation-details.ts";
import type { PiMutationDetails } from "./mutation-details.ts";
import { toPiPart } from "./parts.ts";
import type { PiContentPart } from "./parts.ts";

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

/** Read options. converters defaults to [imageConverter()]; [] turns images off. */
export type AgentCoreFsToolsReadOptions = Omit<Partial<ReadToolOptions<Host>>, FsToolsSharedKey> & {
  /** Default defaultReadSignature(), as in every integration. */
  readonly signature?: ReadSignature;
};
export type AgentCoreFsToolsEditOptions = Omit<Partial<EditToolOptions<Host>>, FsToolsSharedKey> & {
  /** Default defaultEditSignature({ matchers }): { path, old_string, new_string, replace_all? }. */
  readonly signature?: EditSignature;
};
export type AgentCoreFsToolsWriteOptions = Omit<
  Partial<WriteToolOptions<Host>>,
  FsToolsSharedKey
> & {
  /** Default defaultWriteSignature(). */
  readonly signature?: WriteSignature;
};
export type AgentCoreFsToolsApplyPatchOptions = Omit<
  Partial<ApplyPatchToolOptions<Host>>,
  FsToolsSharedKey
> & {
  /** Default defaultPatchSignature(): { patch } with the Codex patch format. */
  readonly signature?: PatchSignature;
};
/** bash options. `runner` and `env` are required. */
export type AgentCoreFsToolsBashOptions = FsToolsBashOptions<Host> & {
  /** Default defaultBashSignature(): { command, timeout?, cwd? } with the timeout in milliseconds. */
  readonly signature?: BashSignature;
};

export interface AgentCoreFsToolsOptions {
  /** Required. A writable backend, or a factory called once for each call. */
  readonly fs: FsToolsOptions<Host>["fs"];
  /** Default null: no read-before-write. A store, for example memoryStore(), turns it on. */
  readonly state?: ReadStateStore | null;
  /** Default sha256Digest() from @better-fs-tools/read, which runs in a Worker. */
  readonly digest?: Digest;
  /** Default memoryLocks(). */
  readonly locks?: LockManager;
  /** Default () => new Date(). */
  readonly clock?: Clock;
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
  readonly state: ReadStateStore | null;
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /** As createFsTools().invalidate. When fs is a factory, pass the call context. */
  invalidate(path: string, call?: ToolCallContext<Host>): Promise<InvalidateOutcome>;
}

const KNOWN: ReadonlySet<string> = new Set([
  "fs",
  "state",
  "digest",
  "locks",
  "clock",
  "read",
  "edit",
  "write",
  "applyPatch",
  "bash",
]);

/**
 * Creates read, edit, and write AgentTools over one writable filesystem, with
 * one digest, lock manager, and clock, and the read store when `state` is
 * given. With `applyPatch`, also apply_patch. With `bash`, also bash. The
 * default signatures are the shared defaults of every integration.
 *
 * A tool error is a result with `isError: true`, not a throw. Bad model input
 * throws TypeError. Throws TypeError on an unknown option key, and on what
 * createFsTools() refuses.
 */
export function createAgentCoreFsTools(options: AgentCoreFsToolsOptions): AgentCoreFsTools {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("createAgentCoreFsTools options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!KNOWN.has(key)) throw new TypeError(`Unknown createAgentCoreFsTools option: ${key}`);
  }
  const { signature: readSignature = defaultReadSignature(), ...read } = options.read ?? {};
  const { signature: editGiven, ...edit } = options.edit ?? {};
  const editSignature =
    editGiven ??
    defaultEditSignature(edit.matchers === undefined ? {} : { matchers: edit.matchers });
  const { signature: writeSignature = defaultWriteSignature(), ...write } = options.write ?? {};
  const patchOptions =
    options.applyPatch === true ? {} : options.applyPatch === false ? null : options.applyPatch;
  const patch =
    patchOptions === null || patchOptions === undefined ? null : splitPatchOptions(patchOptions);
  const bashOptions = options.bash === undefined || options.bash === false ? null : options.bash;
  const bash = bashOptions === null ? null : splitBashOptions(bashOptions);

  const limits = resolveReadLimits(read.limits);
  const formatter = read.formatter ?? lineNumberFormatter();
  const core = createFsTools<Host>({
    fs: options.fs,
    ...(options.state === undefined ? {} : { state: options.state }),
    ...(options.digest === undefined ? {} : { digest: options.digest }),
    ...(options.locks === undefined ? {} : { locks: options.locks }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    read: {
      ...read,
      limits,
      formatter,
      converters: read.converters ?? [imageConverter<Host>()],
      messages: { ...readSignatureMessages(readSignature), ...read.messages },
    },
    edit: { ...edit, messages: { ...writeSignatureMessages(editSignature), ...edit.messages } },
    write: {
      ...write,
      messages: { ...writeSignatureMessages(writeSignature), ...write.messages },
    },
    ...(patch === null
      ? {}
      : {
          applyPatch: {
            ...patch.deps,
            messages: { ...writeSignatureMessages(patch.signature), ...patch.deps.messages },
          },
        }),
    ...(bash === null
      ? {}
      : {
          bash: {
            ...bash.deps,
            messages: { ...bashSignatureMessages(bash.signature), ...bash.deps.messages },
          },
        }),
  });

  const readTool: AgentCoreReadTool = Object.freeze<AgentCoreReadTool>({
    ...declaration(readSignature),
    replay: "safe",
    async execute(toolCallId, params, signal) {
      const call = callOf(toolCallId, signal);
      const result = await core.read(readSignature.toInput(params), call);
      const content = result.content.map((part) => toPiPart(part, "read"));
      const view = viewOf(formatter, result, { digest: core.digest, limits, mode: "view", call });
      const details = toPiReadDetails(result, view, limits.maxViewBytes);
      return { content, details, isError: result.status === "error" };
    },
  });
  const adapted = {
    read: readTool,
    edit: mutationTool(editSignature, "edit", core.edit),
    write: mutationTool(writeSignature, "write", core.write),
    applyPatch:
      patch === null || core.applyPatch === null
        ? null
        : mutationTool(patch.signature, "apply_patch", core.applyPatch),
    bash: bash === null || core.bash === null ? null : bashTool(bash.signature, core.bash),
  };
  const tools = Object.values(adapted).filter((tool) => tool !== null);
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new TypeError(`createAgentCoreFsTools has two tools named ${tool.name}`);
    }
    names.add(tool.name);
  }
  return Object.freeze<AgentCoreFsTools>({
    ...adapted,
    tools: Object.freeze(tools),
    state: core.state,
    digest: core.digest,
    locks: core.locks,
    clock: core.clock,
    invalidate: core.invalidate,
  });
}

function splitPatchOptions(options: AgentCoreFsToolsApplyPatchOptions) {
  const { signature = defaultPatchSignature(), ...deps } = options;
  return { signature, deps };
}

function splitBashOptions(options: AgentCoreFsToolsBashOptions) {
  const { signature, ...deps } = options;
  const runnerId = typeof deps.runner === "function" ? undefined : deps.runner?.id;
  return {
    deps,
    signature:
      signature ??
      defaultBashSignature({
        ...(runnerId === undefined ? {} : { runner: runnerId }),
        ...(deps.limits === undefined ? {} : { limits: deps.limits }),
      }),
  };
}

function declaration(signature: {
  readonly name: string;
  readonly description: string;
  readonly schema: object;
  readonly grammar?: { readonly lark: string };
}) {
  return {
    name: signature.name,
    label: signature.name,
    description: signature.description,
    parameters: Type.Unsafe(signature.schema),
    ...(signature.grammar === undefined
      ? {}
      : {
          constrainedSampling: {
            type: "grammar" as const,
            variants: { openai_lark: signature.grammar.lark },
          },
        }),
  };
}

function callOf(toolCallId: string, signal: AbortSignal | undefined): ToolCallContext<Host> {
  return { ...(signal === undefined ? {} : { signal }), callId: toolCallId, host: undefined };
}

type MutationCore = (input: never, call: ToolCallContext<Host>) => Promise<MutationResult>;

function mutationTool(
  signature: MutationSignature<unknown>,
  tool: "edit" | "write" | "apply_patch",
  run: MutationCore,
): AgentCoreMutationTool {
  return Object.freeze<AgentCoreMutationTool>({
    ...declaration(signature),
    async execute(toolCallId, params, signal) {
      const result = await run(signature.toInput(params) as never, callOf(toolCallId, signal));
      return {
        content: result.content.map((part) => toPiPart(part, tool)),
        // The coding agent's own write has no details.
        details: tool === "write" ? undefined : toPiMutationDetails(result),
        isError: result.status === "error",
      };
    },
  });
}

type BashCore = (input: never, call: ToolCallContext<Host>) => Promise<ShellResult>;

function bashTool(signature: BashSignature, run: BashCore): AgentCoreBashTool {
  return Object.freeze<AgentCoreBashTool>({
    ...declaration(signature),
    async execute(toolCallId, params, signal) {
      const result = await run(signature.toInput(params) as never, callOf(toolCallId, signal));
      const spill = result.output?.spill ?? null;
      return {
        content: result.content.map((part) => toPiPart(part, "bash")),
        details: spill === null ? undefined : { fullOutputPath: spill },
        isError: result.status !== "ok",
      };
    },
  });
}
