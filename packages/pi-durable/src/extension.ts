import type { Context } from "@earendil-works/chord/context";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Extension, ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { Type } from "typebox";

import { imageConverter } from "@better-fs-tools/read";
import type {
  Clock,
  ContentPart,
  Digest,
  ReadStateStore,
  ReadToolDeps,
  ToolCallContext,
} from "@better-fs-tools/read";
import { defaultReadSignature, readSignatureMessages } from "@better-fs-tools/read/signature";
import type { ReadSignature } from "@better-fs-tools/read/signature";
import { shellEnv } from "@better-fs-tools/shell";
import type { ShellResult, ShellToolDeps } from "@better-fs-tools/shell";
import { bashSignatureMessages, defaultBashSignature } from "@better-fs-tools/shell/signature";
import type { BashSignature } from "@better-fs-tools/shell/signature";
import { createFsTools, memoryLocks } from "@better-fs-tools/write";
import type {
  ApplyPatchToolDeps,
  EditToolDeps,
  FsToolsSharedKey,
  LockManager,
  MutationResult,
  WriteToolDeps,
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

import { executionEnvFileSystem } from "./filesystem.ts";
import type { EnvSymlinkPolicy } from "./policy.ts";
import { documentReadStore } from "./read-store.ts";
import { executionEnvRunner } from "./runner.ts";

/** The host of each call. Host functions, such as an authorizer, get it as ctx.call.host. */
export interface DurableFsHost {
  readonly api: ToolExecutionApi;
  readonly env: ExecutionEnv;
  readonly context: Context;
}

type Host = DurableFsHost;
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Above the default view of 2,000 lines and 50 KiB, so the Harness does not cut it again. */
const DEFAULT_OUTPUT_LIMITS = Object.freeze({ maxBytes: 128 * 1024, maxLines: 4_000 });

export type DurableFsToolsReadOptions = Omit<Partial<ReadToolDeps<Host>>, FsToolsSharedKey> & {
  /** Default defaultReadSignature(), as in every integration. */
  readonly signature?: ReadSignature;
};
export type DurableFsToolsEditOptions = Omit<Partial<EditToolDeps<Host>>, FsToolsSharedKey> & {
  /** Default defaultEditSignature({ matchers }): { path, old_string, new_string, replace_all? }. */
  readonly signature?: EditSignature;
};
export type DurableFsToolsWriteOptions = Omit<Partial<WriteToolDeps<Host>>, FsToolsSharedKey> & {
  /** Default defaultWriteSignature(). */
  readonly signature?: WriteSignature;
};
export type DurableFsToolsApplyPatchOptions = Omit<
  Partial<ApplyPatchToolDeps<Host>>,
  FsToolsSharedKey
> & {
  /** Default defaultPatchSignature(). */
  readonly signature?: PatchSignature;
};
export type DurableFsToolsBashOptions = Omit<
  Partial<ShellToolDeps<Host>>,
  "runner" | "digest" | "clock"
> & {
  /** Default defaultBashSignature(): { command, timeout?, cwd? } with the timeout in milliseconds. */
  readonly signature?: BashSignature;
  /** Default true: the command keeps the environment's own variables. See executionEnvRunner. */
  readonly inheritEnv?: boolean;
};

export interface CreateDurableFsToolsOptions {
  /** The extension name. Default "better-fs-tools". */
  readonly name?: string;
  /**
   * Default null: no read-before-write, as in every integration. "document"
   * keeps the read records in the conversation's ReadStateDoc documents, so
   * they stay after a restart and follow a fork. A store is shared by every
   * conversation.
   */
  readonly state?: "document" | ReadStateStore | null;
  /** Default sha256Digest(). */
  readonly digest?: Digest;
  /**
   * Default memoryLocks(), shared by every call of the extension. The keys
   * get the environment id, so two environments never wait for each other.
   */
  readonly locks?: LockManager;
  /** Default () => new Date(). */
  readonly clock?: Clock;
  /**
   * The roots of each call's filesystem, relative to the environment's cwd.
   * Default allowedRoots ["."]: only the working directory of the call.
   */
  readonly allowedRoots?: readonly string[];
  readonly denyRoots?: readonly string[];
  /** Default "follow-within-roots". */
  readonly symlinks?: EnvSymlinkPolicy;
  /** The Harness output limits of read, edit, write, and apply_patch. Default 128 KiB and 4,000 lines. */
  readonly outputLimits?: ToolRegistration["outputLimits"];
  readonly read?: DurableFsToolsReadOptions;
  readonly edit?: DurableFsToolsEditOptions;
  readonly write?: DurableFsToolsWriteOptions;
  /** Off by default. `true` or an options object adds apply_patch. */
  readonly applyPatch?: boolean | DurableFsToolsApplyPatchOptions;
  /**
   * Off by default, so the bash of CodingTools stays. `true` or an options
   * object adds a bash tool over the environment's exec().
   */
  readonly bash?: boolean | DurableFsToolsBashOptions;
}

const KNOWN: ReadonlySet<string> = new Set([
  "name",
  "state",
  "digest",
  "locks",
  "clock",
  "allowedRoots",
  "denyRoots",
  "symlinks",
  "outputLimits",
  "read",
  "edit",
  "write",
  "applyPatch",
  "bash",
]);

/**
 * A pi-durable extension with Better FS Tools read, edit, and write, and
 * optionally apply_patch and bash. Install it after CodingTools: a later
 * extension's tool with the same name replaces the earlier one.
 *
 * Each call reads and writes through the call's ExecutionEnv (api.env), so the
 * tools work on the local machine, over SSH with pi-env, and in a container.
 * read is replay-safe. edit, write, and apply_patch are not: after a crash the
 * model gets an interrupted result and reads the file again.
 *
 * Throws TypeError on an unknown option key. A call without an environment
 * fails with an error result.
 */
export function createDurableFsTools(options: CreateDurableFsToolsOptions = {}): Extension {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("createDurableFsTools options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!KNOWN.has(key)) throw new TypeError(`Unknown createDurableFsTools option: ${key}`);
  }
  const locks = options.locks ?? memoryLocks();
  const outputLimits = options.outputLimits ?? DEFAULT_OUTPUT_LIMITS;
  const { signature: readSignature = defaultReadSignature(), ...read } = options.read ?? {};
  const { signature: editGiven, ...edit } = options.edit ?? {};
  const editSignature =
    editGiven ??
    defaultEditSignature(edit.matchers === undefined ? {} : { matchers: edit.matchers });
  const { signature: writeSignature = defaultWriteSignature(), ...write } = options.write ?? {};
  const patchOptions =
    options.applyPatch === true ? {} : options.applyPatch === false ? null : options.applyPatch;
  const { signature: patchSignature = defaultPatchSignature(), ...patch } = patchOptions ?? {};
  const bashOptions = options.bash === true ? {} : options.bash === false ? null : options.bash;
  const { signature: bashGiven, inheritEnv, ...bash } = bashOptions ?? {};
  const bashSignature =
    bashGiven ?? defaultBashSignature(bash.limits === undefined ? {} : { limits: bash.limits });

  /** The core tools of one call, over the call's environment, store, and lock keys. */
  const toolsFor = (api: ToolExecutionApi, context: Context) => {
    const env = api.env;
    if (env === undefined) throw new Error("Better FS Tools needs an execution environment");
    const fs = executionEnvFileSystem(env, {
      context,
      allowedRoots: options.allowedRoots ?? ["."],
      ...(options.denyRoots === undefined ? {} : { denyRoots: options.denyRoots }),
      ...(options.symlinks === undefined ? {} : { symlinks: options.symlinks }),
    });
    const state =
      options.state === "document"
        ? documentReadStore(api, env.id, context)
        : (options.state ?? null);
    const host: Host = { api, env, context };
    const core = createFsTools<Host>({
      fs,
      state,
      locks: keyedLocks(locks, env.id),
      ...(options.digest === undefined ? {} : { digest: options.digest }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      read: {
        ...read,
        converters: read.converters ?? [imageConverter<Host>()],
        messages: { ...readSignatureMessages(readSignature), ...read.messages },
      },
      edit: { ...edit, messages: { ...writeSignatureMessages(editSignature), ...edit.messages } },
      write: {
        ...write,
        messages: { ...writeSignatureMessages(writeSignature), ...write.messages },
      },
      ...(patchOptions === null || patchOptions === undefined
        ? {}
        : {
            applyPatch: {
              ...patch,
              messages: { ...writeSignatureMessages(patchSignature), ...patch.messages },
            },
          }),
      ...(bashOptions === null || bashOptions === undefined
        ? {}
        : {
            bash: {
              ...bash,
              runner: executionEnvRunner(env, {
                context,
                ...(inheritEnv === undefined ? {} : { inheritEnv }),
              }),
              env: bash.env ?? shellEnv(),
              messages: { ...bashSignatureMessages(bashSignature), ...bash.messages },
            },
          }),
    });
    const call: ToolCallContext<Host> = {
      ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
      callId: api.callId,
      host,
    };
    return { core, call };
  };

  const tools: ToolRegistration[] = [
    defineTool({
      ...declaration(readSignature),
      replay: "safe",
      outputLimits,
      async execute(args, api, context) {
        const { core, call } = toolsFor(api, context);
        const result = await core.read(readSignature.toInput(args), call);
        return { output: toOutput(result.content), isError: result.status === "error" };
      },
    }),
    mutationTool(editSignature, outputLimits, async (args, api, context) => {
      const { core, call } = toolsFor(api, context);
      return core.edit(editSignature.toInput(args), call);
    }),
    mutationTool(writeSignature, outputLimits, async (args, api, context) => {
      const { core, call } = toolsFor(api, context);
      return core.write(writeSignature.toInput(args), call);
    }),
  ];
  if (patchOptions !== null && patchOptions !== undefined) {
    tools.push(
      mutationTool(patchSignature, outputLimits, async (args, api, context) => {
        const { core, call } = toolsFor(api, context);
        if (core.applyPatch === null) throw new Error("apply_patch is off");
        return core.applyPatch(patchSignature.toInput(args), call);
      }),
    );
  }
  if (bashOptions !== null && bashOptions !== undefined) {
    tools.push(
      defineTool({
        ...declaration(bashSignature),
        outputLimits: { ...outputLimits, retain: "tail" },
        async execute(args, api, context) {
          const { core, call } = toolsFor(api, context);
          if (core.bash === null) throw new Error("bash is off");
          const result = await core.bash(bashSignature.toInput(args), call);
          return bashResult(result);
        },
      }),
    );
  }
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new TypeError(`createDurableFsTools has two tools named ${tool.name}`);
    }
    names.add(tool.name);
  }
  return defineExtension({ name: options.name ?? "better-fs-tools", tools });
}

function declaration(signature: {
  readonly name: string;
  readonly description: string;
  readonly schema: object;
}) {
  return {
    name: signature.name,
    description: signature.description,
    parameters: Type.Unsafe(signature.schema),
  };
}

function mutationTool(
  signature: MutationSignature<unknown>,
  outputLimits: ToolRegistration["outputLimits"],
  run: (args: unknown, api: ToolExecutionApi, context: Context) => Promise<MutationResult>,
): ToolRegistration {
  return defineTool({
    ...declaration(signature),
    ...(outputLimits === undefined ? {} : { outputLimits }),
    async execute(args, api, context) {
      const result = await run(args, api, context);
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
