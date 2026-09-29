import type { ToolExecutionOptions } from "ai";

import type {
  Clock,
  Digest,
  ReadStateStore,
  ReadToolDeps,
  ToolCallContext,
} from "@better-fs-tools/read";
import { readSignatureMessages, defaultReadSignature } from "@better-fs-tools/read/signature";
import type { ReadSignature } from "@better-fs-tools/read/signature";
import { bashSignatureMessages } from "@better-fs-tools/shell/signature";
import type { BashSignature } from "@better-fs-tools/shell/signature";
import {
  createFsTools,
  parseApplyPatchInput,
  parseEditInput,
  parseWriteInput,
} from "@better-fs-tools/write";
import type {
  ApplyPatchToolDeps,
  CreateFsToolsOptions,
  EditToolDeps,
  FsToolsBashOptions,
  FsToolsSharedKey,
  InvalidateOutcome,
  LockManager,
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
  PatchSignature,
  WriteSignature,
} from "@better-fs-tools/write/signature";

import { adaptBashTool, defaultAiSdkBashSignature } from "./bash-tool.ts";
import type { AiSdkBashTool } from "./bash-tool.ts";
import { adaptMutationTool, matchersOf } from "./mutation-tools.ts";
import type { AiSdkMutationTool } from "./mutation-tools.ts";
import { adaptReadTool } from "./tool.ts";
import type { AiSdkReadTool } from "./tool.ts";

type Host<C> = ToolExecutionOptions<C>;

/** A tool's options in the bundle: its core options less the shared ones, and its signature. */
export type AiSdkFsToolsReadOptions<C = unknown> = Omit<
  Partial<ReadToolDeps<Host<C>>>,
  FsToolsSharedKey
> & {
  /** Default defaultReadSignature(). */
  readonly signature?: ReadSignature;
};
export type AiSdkFsToolsEditOptions<C = unknown> = Omit<
  Partial<EditToolDeps<Host<C>>>,
  FsToolsSharedKey
> & {
  /** Default defaultEditSignature({ matchers }). */
  readonly signature?: EditSignature;
};
export type AiSdkFsToolsWriteOptions<C = unknown> = Omit<
  Partial<WriteToolDeps<Host<C>>>,
  FsToolsSharedKey
> & {
  /** Default defaultWriteSignature(). */
  readonly signature?: WriteSignature;
};
export type AiSdkFsToolsApplyPatchOptions<C = unknown> = Omit<
  Partial<ApplyPatchToolDeps<Host<C>>>,
  FsToolsSharedKey
> & {
  /** Default defaultPatchSignature(). */
  readonly signature?: PatchSignature;
};
/** The bash dependencies with `runner` and `env` required, less the shared digest and clock. */
export type AiSdkFsToolsBashOptions<C = unknown> = FsToolsBashOptions<Host<C>> & {
  /** Default defaultBashSignature({ runner: runner.id, limits }). */
  readonly signature?: BashSignature;
};

export interface CreateAiSdkFsToolsOptions<C = unknown> {
  /** Required. A backend, or a factory called once for each call with the AI SDK options as host. */
  readonly fs: CreateFsToolsOptions<Host<C>>["fs"];
  /** Default memoryStore({ clock }), on the bundle clock. null turns read-before-write off. */
  readonly state?: ReadStateStore | null;
  /** Default sha256Digest() from @better-fs-tools/read: plain JavaScript, so it runs in a Worker. */
  readonly digest?: Digest;
  /** Default memoryLocks(). */
  readonly locks?: LockManager;
  /** Default () => new Date(). */
  readonly clock?: Clock;
  readonly read?: AiSdkFsToolsReadOptions<C>;
  readonly edit?: AiSdkFsToolsEditOptions<C>;
  readonly write?: AiSdkFsToolsWriteOptions<C>;
  readonly applyPatch?: AiSdkFsToolsApplyPatchOptions<C>;
  /** Off by default. This package starts no process: give a runner and an env to turn bash on. */
  readonly bash?: false | AiSdkFsToolsBashOptions<C>;
}

export interface AiSdkFsTools<C = unknown> {
  readonly read: AiSdkReadTool<C>;
  readonly edit: AiSdkMutationTool<C>;
  readonly write: AiSdkMutationTool<C>;
  readonly applyPatch: AiSdkMutationTool<C>;
  /** null unless options.bash is set. */
  readonly bash: AiSdkBashTool<C> | null;
  /** Every tool of the bundle keyed by its name, ready for generateText({ tools }). */
  readonly tools: Readonly<
    Record<string, AiSdkReadTool<C> | AiSdkMutationTool<C> | AiSdkBashTool<C>>
  >;
  readonly state: ReadStateStore | null;
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /** As createFsTools: when fs is a factory, pass the call context. */
  invalidate(path: string, call?: ToolCallContext<Host<C>>): Promise<InvalidateOutcome>;
}

/** The result when options.bash is an object: bash is there. */
export interface AiSdkFsToolsWithBash<C = unknown> extends AiSdkFsTools<C> {
  readonly bash: AiSdkBashTool<C>;
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

/** The keys each tool's options may not set, because the bundle shares them. */
const SHARED_KEYS = {
  read: ["fs", "state", "digest", "clock"],
  edit: ["fs", "state", "digest", "locks", "clock"],
  write: ["fs", "state", "digest", "locks", "clock"],
  applyPatch: ["fs", "state", "digest", "locks", "clock"],
  bash: ["digest", "clock"],
} as const;

/**
 * createFsTools from @better-fs-tools/write, with each tool adapted as the
 * single AI SDK factories adapt it. One call gives read, edit, write, and
 * apply_patch over one backend, with one store, one digest (sha256Digest()
 * by default), one lock manager, and one clock. It needs no Node module, so
 * an AI SDK host on Workers gets shared state in one call. With `bash`, a
 * bash tool with the same digest and clock.
 *
 * Throws TypeError on an unknown option key, and on a shared key (fs, state,
 * digest, locks, clock) inside a tool's options.
 */
export function createAiSdkFsTools<C = unknown>(
  options: CreateAiSdkFsToolsOptions<C> & { readonly bash: AiSdkFsToolsBashOptions<C> },
): AiSdkFsToolsWithBash<C>;
export function createAiSdkFsTools<C = unknown>(
  options: CreateAiSdkFsToolsOptions<C>,
): AiSdkFsTools<C>;
export function createAiSdkFsTools<C = unknown>(
  options: CreateAiSdkFsToolsOptions<C>,
): AiSdkFsTools<C> {
  checkOptions(options);
  const { signature: readSignature = defaultReadSignature(), ...read } = options.read ?? {};
  const { signature: editGiven, ...edit } = options.edit ?? {};
  const editSignature = editGiven ?? defaultEditSignature(matchersOf(edit.matchers));
  const { signature: writeSignature = defaultWriteSignature(), ...write } = options.write ?? {};
  const { signature: patchSignature = defaultPatchSignature(), ...applyPatch } =
    options.applyPatch ?? {};
  const bashOptions = options.bash === undefined || options.bash === false ? null : options.bash;
  let bash: {
    readonly deps: FsToolsBashOptions<Host<C>>;
    readonly signature: BashSignature;
  } | null = null;
  if (bashOptions !== null) {
    const { signature, ...deps } = bashOptions;
    bash = { deps, signature: signature ?? defaultAiSdkBashSignature(deps) };
  }

  const core = createFsTools<Host<C>>({
    fs: options.fs,
    ...(options.state === undefined ? {} : { state: options.state }),
    ...(options.digest === undefined ? {} : { digest: options.digest }),
    ...(options.locks === undefined ? {} : { locks: options.locks }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    read: { ...read, messages: { ...readSignatureMessages(readSignature), ...read.messages } },
    edit: { ...edit, messages: { ...writeSignatureMessages(editSignature), ...edit.messages } },
    write: {
      ...write,
      messages: { ...writeSignatureMessages(writeSignature), ...write.messages },
    },
    applyPatch: {
      ...applyPatch,
      messages: { ...writeSignatureMessages(patchSignature), ...applyPatch.messages },
    },
    ...(bash === null
      ? {}
      : {
          bash: {
            ...bash.deps,
            messages: { ...bashSignatureMessages(bash.signature), ...bash.deps.messages },
          },
        }),
  });

  const adapted = {
    read: adaptReadTool<C>(readSignature, core.read, read.limits),
    edit: adaptMutationTool(editSignature, core.edit, parseEditInput, edit.limits),
    write: adaptMutationTool(writeSignature, core.write, parseWriteInput, write.limits),
    applyPatch: adaptMutationTool(
      patchSignature,
      core.applyPatch,
      parseApplyPatchInput,
      applyPatch.limits,
    ),
    bash:
      bash === null || core.bash === null
        ? null
        : adaptBashTool<C>(bash.signature, core.bash, bash.deps.limits),
  };
  const tools: Record<string, AiSdkReadTool<C> | AiSdkMutationTool<C> | AiSdkBashTool<C>> = {};
  for (const tool of Object.values(adapted)) {
    if (tool === null) continue;
    if (Object.hasOwn(tools, tool.name)) {
      throw new TypeError(`createAiSdkFsTools has two tools named ${tool.name}`);
    }
    tools[tool.name] = tool;
  }
  return Object.freeze<AiSdkFsTools<C>>({
    ...adapted,
    tools: Object.freeze(tools),
    state: core.state,
    digest: core.digest,
    locks: core.locks,
    clock: core.clock,
    invalidate: core.invalidate,
  });
}

/** An object, known keys, and no shared key inside a tool's options (GA-16). */
function checkOptions(options: unknown): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("createAiSdkFsTools options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!KNOWN.has(key)) throw new TypeError(`Unknown createAiSdkFsTools option: ${key}`);
  }
  const state: unknown = (options as Record<string, unknown>).state;
  if (state !== undefined && state !== null && !isStore(state)) {
    throw new TypeError(
      `createAiSdkFsTools state must be a read state store or null: a bundle takes one store, not a per-call factory`,
    );
  }
  for (const [tool, keys] of Object.entries(SHARED_KEYS)) {
    const part: unknown = (options as Record<string, unknown>)[tool];
    if (part === undefined || (tool === "bash" && part === false)) continue;
    if (tool === "bash" && part === true) {
      throw new TypeError(
        "createAiSdkFsTools bash must be an object with a runner and an env: the portable bundle has no default runner",
      );
    }
    if (part === null || typeof part !== "object" || Array.isArray(part)) {
      throw new TypeError(`createAiSdkFsTools ${tool} options must be an object`);
    }
    for (const key of keys) {
      if (Object.hasOwn(part, key)) {
        throw new TypeError(
          `createAiSdkFsTools ${tool} options cannot set ${key}: set it once at the top level`,
        );
      }
    }
  }
}

/** A read state store: an object with get, put, and delete. A per-call factory is not one. */
function isStore(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const store = value as Record<string, unknown>;
  return ["get", "put", "delete"].every((key) => typeof store[key] === "function");
}
