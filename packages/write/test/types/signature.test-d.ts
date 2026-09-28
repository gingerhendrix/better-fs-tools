/**
 * Type tests. `tsc -b` checks this file through the package tsconfig. Bun never
 * runs it: the name does not match Bun's test file pattern.
 */
import type { ToolSignature } from "@better-fs-tools/read";

import type { EditInput, WriteCanonicalParam } from "../../src/index.ts";
import { defaultEditSignature, defaultWriteSignature } from "../../src/signature/index.ts";
import type { EditSignature } from "../../src/signature/index.ts";

// A write signature is the shared base with the write canonical parameters.
export const editBase: ToolSignature<EditInput, WriteCanonicalParam> = defaultEditSignature();
export const fromBase: EditSignature = {} as ToolSignature<EditInput, WriteCanonicalParam>;

export const renamed = defaultWriteSignature({ names: { path: "file" } });

// @ts-expect-error: names use the preset's own parameter names, not the canonical ones.
defaultEditSignature({ names: { oldText: "find" } });
