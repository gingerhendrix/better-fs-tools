import type { Clock, Digest } from "@better-fs-tools/read";
import { readToolDefinition } from "@better-fs-tools/read/signature";
import type { ReadSignature, ReadToolDefinition } from "@better-fs-tools/read/signature";
import { bashToolDefinition } from "@better-fs-tools/shell/signature";
import type { BashSignature, BashToolDefinition } from "@better-fs-tools/shell/signature";

import type { LockManager } from "../contract/locks.ts";
import {
  applyPatchToolDefinition,
  editToolDefinition,
  writeToolDefinition,
} from "../signature/definition.ts";
import type {
  ApplyPatchToolDefinition,
  EditToolDefinition,
  WriteToolDefinition,
} from "../signature/definition.ts";
import type { EditSignature, PatchSignature, WriteSignature } from "../signature/contract.ts";
import { resolveBundle } from "./create-fs-tools.ts";
import type {
  FsTools,
  FsToolsApplyPatchOptions,
  FsToolsBashOptions,
  FsToolsEditOptions,
  FsToolsOptions,
  FsToolsReadOptions,
  FsToolsState,
  FsToolsWriteOptions,
} from "./create-fs-tools.ts";

/** The options of createFsTools(), with a `signature` in each tool's options. */
export interface FsToolDefinitionsOptions<THost = undefined> extends Omit<
  FsToolsOptions<THost>,
  "read" | "edit" | "write" | "applyPatch" | "bash"
> {
  readonly read?: FsToolsReadOptions<THost> & { readonly signature?: ReadSignature };
  readonly edit?: FsToolsEditOptions<THost> & { readonly signature?: EditSignature };
  readonly write?: FsToolsWriteOptions<THost> & { readonly signature?: WriteSignature };
  /** Off by default. `true` or an options object adds apply_patch. */
  readonly applyPatch?:
    | boolean
    | (FsToolsApplyPatchOptions<THost> & { readonly signature?: PatchSignature });
  /** Off by default. The bash options, with `runner` and `env` required. */
  readonly bash?: false | (FsToolsBashOptions<THost> & { readonly signature?: BashSignature });
}

/** The tool definitions of one bundle, and the parts they share. */
export interface FsToolDefinitions<THost = undefined> {
  readonly read: ReadToolDefinition<THost>;
  readonly edit: EditToolDefinition<THost>;
  readonly write: WriteToolDefinition<THost>;
  /** null unless options.applyPatch is true or an object. */
  readonly applyPatch: ApplyPatchToolDefinition<THost> | null;
  /** null unless options.bash is set. */
  readonly bash: BashToolDefinition<THost> | null;
  readonly fs: FsToolsOptions<THost>["fs"];
  readonly state: FsToolsState<THost>;
  readonly digest: Digest;
  readonly locks: LockManager;
  readonly clock: Clock;
  /** As createFsTools().invalidate. */
  readonly invalidate: FsTools<THost>["invalidate"];
}

/**
 * The bundle of createFsTools(), with each tool bound to its signature by
 * readToolDefinition() and the other definition helpers. Every integration
 * bundle builds on it. Throws TypeError where createFsTools() does, with
 * "fsToolDefinitions" in the message.
 */
export function fsToolDefinitions<THost = undefined>(
  options: FsToolDefinitionsOptions<THost>,
): FsToolDefinitions<THost> {
  const bundle = resolveBundle("fsToolDefinitions", options);
  const { fs, state, digest, locks, clock } = bundle;
  const shared = { fs, state, digest, clock };
  return Object.freeze<FsToolDefinitions<THost>>({
    read: readToolDefinition<THost>({ ...options.read, ...shared }),
    edit: editToolDefinition<THost>({ ...options.edit, ...shared, locks }),
    write: writeToolDefinition<THost>({ ...options.write, ...shared, locks }),
    applyPatch:
      bundle.applyPatch === null
        ? null
        : applyPatchToolDefinition<THost>({ ...bundle.applyPatch, ...shared, locks }),
    bash:
      bundle.bash === null ? null : bashToolDefinition<THost>({ ...bundle.bash, digest, clock }),
    fs,
    state,
    digest,
    locks,
    clock,
    invalidate: bundle.invalidate,
  });
}
