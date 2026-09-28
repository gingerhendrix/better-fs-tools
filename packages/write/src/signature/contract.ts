import type { ToolSignature } from "@better-fs-tools/read";

import type { ApplyPatchInput, EditInput, WriteInput } from "../contract/input.ts";
import type { WriteCanonicalParam } from "../contract/messages.ts";

/** A write tool's signature: the shared base with the write canonical parameters. */
export type MutationSignature<TInput> = ToolSignature<TInput, WriteCanonicalParam>;

export type EditSignature = MutationSignature<EditInput>;
export type WriteSignature = MutationSignature<WriteInput>;
export type PatchSignature = MutationSignature<ApplyPatchInput>;
