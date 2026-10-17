import type { Context } from "@earendil-works/chord/context";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Extension, ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
import { Type } from "typebox";

import type { ContentPart, ToolCallContext } from "@better-fs-tools/read";
import type { ReadSignature } from "@better-fs-tools/read/signature";
import type { ShellResult } from "@better-fs-tools/shell";
import type { BashSignature } from "@better-fs-tools/shell/signature";
import type {
  FsToolsApplyPatchOptions,
  FsToolsBashOptions,
  FsToolsEditOptions,
  FsToolsOptions,
  FsToolsReadOptions,
  FsToolsWriteOptions,
  LockManager,
  MutationResult,
} from "@better-fs-tools/write";
import { fsToolDefinitions } from "@better-fs-tools/write/signature";
import type {
  EditSignature,
  FsToolDefinitions,
  FsToolDefinitionsOptions,
  PatchSignature,
  WriteSignature,
} from "@better-fs-tools/write/signature";

import type { DurableFsHost } from "./host.ts";

type Host = DurableFsHost;
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const LABEL = "createDurableFsTools";

/** Above the default view of 2,000 lines and 50 KiB, so the Harness does not cut it again. */
const DEFAULT_OUTPUT_LIMITS = Object.freeze({ maxBytes: 128 * 1024, maxLines: 4_000 });

export type DurableFsToolsReadOptions = FsToolsReadOptions<Host> & {
  /** Default defaultReadSignature(). */
  readonly signature?: ReadSignature;
};
export type DurableFsToolsEditOptions = FsToolsEditOptions<Host> & {
  /** Default defaultEditSignature({ matchers }). */
  readonly signature?: EditSignature;
};
export type DurableFsToolsWriteOptions = FsToolsWriteOptions<Host> & {
  /** Default defaultWriteSignature(). */
  readonly signature?: WriteSignature;
};
export type DurableFsToolsApplyPatchOptions = FsToolsApplyPatchOptions<Host> & {
  /** Default defaultPatchSignature(). */
  readonly signature?: PatchSignature;
};
/** bash options. `runner` and `env` are required: durableEnvRunner() runs over the environment's exec(). */
export type DurableFsToolsBashOptions = FsToolsBashOptions<Host> & {
  /** Default defaultBashSignature() for the runner's id and the limits. */
  readonly signature?: BashSignature;
};

/**
 * The options of createFsTools(), with the call's `{ api, env, context }` as
 * host and a `signature` in each tool's options, plus the Harness settings
 * `name` and `outputLimits`. `fs` is required: durableEnvFileSystem() reads
 * and writes through the call's environment.
 */
export interface DurableFsToolsOptions extends Omit<
  FsToolsOptions<Host>,
  "read" | "edit" | "write" | "applyPatch" | "bash"
> {
  /** The extension name. Default "better-fs-tools". */
  readonly name?: string;
  /** The Harness output limits of read, edit, write, and apply_patch. Default 128 KiB and 4,000 lines. */
  readonly outputLimits?: ToolRegistration["outputLimits"];
  readonly read?: DurableFsToolsReadOptions;
  readonly edit?: DurableFsToolsEditOptions;
  readonly write?: DurableFsToolsWriteOptions;
  /** Off by default. `true` or an options object adds apply_patch. */
  readonly applyPatch?: boolean | DurableFsToolsApplyPatchOptions;
  /**
   * Off by default, so the bash of CodingTools stays. An options object with a
   * runner and an env adds a bash tool.
   */
  readonly bash?: false | DurableFsToolsBashOptions;
}

/**
 * A pi-durable extension with Better FS Tools read, edit, and write, and
 * optionally apply_patch and bash. Install it after CodingTools: a later
 * extension's tool with the same name replaces the earlier one. Every tool
 * option and default is the one of createFsTools(). The lock keys get the
 * environment id, so the same path in two environments does not wait.
 *
 * read is replay-safe. edit, write, and apply_patch are not: after a crash the
 * model gets an interrupted result and reads the file again.
 *
 * Throws TypeError where createFsTools() does, with createDurableFsTools in the
 * message. A call without an environment fails with an error result.
 */
export function createDurableFsTools(options: DurableFsToolsOptions): Extension {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${LABEL} options must be an object`);
  }
  const { name = "better-fs-tools", outputLimits = DEFAULT_OUTPUT_LIMITS, ...rest } = options;
  // Built once to check the options and to declare the tools. Each call builds its own.
  const declared = fsToolDefinitions<Host>(rest, LABEL);
  const perCall = perCallOptions(rest, declared);

  /** The tool definitions and the call of one tool call, over the call's environment. */
  const definitionsFor = (api: ToolExecutionApi, context: Context) => {
    const env = api.env;
    if (env === undefined) throw new Error("Better FS Tools needs an execution environment");
    const definitions = fsToolDefinitions<Host>(
      { ...perCall, locks: keyedLocks(declared.locks, env.id) },
      LABEL,
    );
    const call: ToolCallContext<Host> = {
      ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
      callId: api.callId,
      host: { api, env, context },
    };
    return { definitions, call };
  };

  const tools: ToolRegistration[] = [
    defineTool({
      ...declaration(declared.read),
      replay: "safe",
      outputLimits,
      async execute(args, api, context) {
        const { definitions, call } = definitionsFor(api, context);
        const result = await definitions.read.execute(args, call);
        return { output: toOutput(result.content), isError: result.status === "error" };
      },
    }),
    mutationTool(declared.edit, outputLimits, (d) => d.edit, definitionsFor),
    mutationTool(declared.write, outputLimits, (d) => d.write, definitionsFor),
  ];
  if (declared.applyPatch !== null) {
    tools.push(
      mutationTool(declared.applyPatch, outputLimits, (d) => d.applyPatch, definitionsFor),
    );
  }
  if (declared.bash !== null) {
    tools.push(
      defineTool({
        ...declaration(declared.bash),
        outputLimits: { ...outputLimits, retain: "tail" },
        async execute(args, api, context) {
          const { definitions, call } = definitionsFor(api, context);
          if (definitions.bash === null) throw new Error("bash is off");
          return bashResult(await definitions.bash.execute(args, call));
        },
      }),
    );
  }
  return defineExtension({ name, tools });
}

/** The options of each call: the given options, with the signatures, digest, and clock of the declared tools. */
function perCallOptions(
  options: FsToolDefinitionsOptions<Host>,
  declared: FsToolDefinitions<Host>,
): FsToolDefinitionsOptions<Host> {
  const applyPatch = options.applyPatch === true ? {} : options.applyPatch;
  return {
    ...options,
    digest: declared.digest,
    clock: declared.clock,
    read: { ...options.read, signature: declared.read.signature },
    edit: { ...options.edit, signature: declared.edit.signature },
    write: { ...options.write, signature: declared.write.signature },
    ...(declared.applyPatch === null || applyPatch === false || applyPatch === undefined
      ? {}
      : { applyPatch: { ...applyPatch, signature: declared.applyPatch.signature } }),
    ...(declared.bash === null || options.bash === false || options.bash === undefined
      ? {}
      : { bash: { ...options.bash, signature: declared.bash.signature } }),
  };
}

type DefinitionsFor = (
  api: ToolExecutionApi,
  context: Context,
) => { readonly definitions: FsToolDefinitions<Host>; readonly call: ToolCallContext<Host> };

interface Declared {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly grammar?: { readonly lark: string };
}

/** A signature with a grammar sets constrainedSampling, as in the Pi integrations. */
function declaration(definition: Declared) {
  return {
    name: definition.name,
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

type MutationDefinition = {
  execute(modelInput: unknown, call: ToolCallContext<Host>): Promise<MutationResult>;
};

function mutationTool(
  declared: Declared,
  outputLimits: ToolRegistration["outputLimits"],
  pick: (definitions: FsToolDefinitions<Host>) => MutationDefinition | null,
  definitionsFor: DefinitionsFor,
): ToolRegistration {
  return defineTool({
    ...declaration(declared),
    ...(outputLimits === undefined ? {} : { outputLimits }),
    async execute(args, api, context) {
      const { definitions, call } = definitionsFor(api, context);
      const definition = pick(definitions);
      if (definition === null) throw new Error(`${declared.name} is off`);
      const result = await definition.execute(args, call);
      return { output: toOutput(result.content), isError: result.status === "error" };
    },
  });
}

/** A nonzero exit, a timeout, an abort, and an error are error results, as in the Pi integration. */
function bashResult(result: ShellResult) {
  return { output: toOutput(result.content), isError: result.status !== "ok" };
}

/** Lock keys with the environment id: one path on two machines is two files. */
function keyedLocks(locks: LockManager, envId: string): LockManager {
  return Object.freeze<LockManager>({
    id: locks.id,
    acquire: (keys, options) =>
      locks.acquire(
        keys.map((key) => `${envId}\0${key}`),
        options,
      ),
  });
}

// Keeps each String.fromCharCode spread under engine argument-count limits.
const CHUNK = 0x8000;

function toOutput(parts: readonly ContentPart[]): Content[] {
  return parts.map((part): Content => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (!part.mediaType.startsWith("image/")) {
      return { type: "text", text: `[media omitted] ${part.mediaType}` };
    }
    let binary = "";
    for (let offset = 0; offset < part.data.byteLength; offset += CHUNK) {
      binary += String.fromCharCode(...part.data.subarray(offset, offset + CHUNK));
    }
    return { type: "image", data: btoa(binary), mimeType: part.mediaType };
  });
}
