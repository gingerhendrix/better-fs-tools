/**
 * Type tests. `tsc -b` checks this file through the package tsconfig. Bun never
 * runs it: the name does not match Bun's test file pattern.
 */
import type { SignatureDocs, ToolSignature } from "@better-fs-tools/read";
import type { ReadSignature } from "@better-fs-tools/read/signature";

import type { BashInput, ShellCanonicalParam } from "../../src/index.ts";
import type { BashParam, BashSignature, BashSignatureOptions } from "../../src/signature/index.ts";

declare const bash: BashSignature;
declare const read: ReadSignature;

// The read and bash signatures share one base, so a host can list them together.
export const signatures: readonly ToolSignature<unknown, never>[] = [bash, read];
export const bashBase: ToolSignature<BashInput, ShellCanonicalParam> = bash;
export const docs: SignatureDocs<BashParam> = {} as BashSignatureOptions;
export const renamed: BashSignatureOptions = { names: { timeout: "timeout_seconds" } };

// @ts-expect-error: names use the preset's own parameter names, not the canonical ones.
export const canonicalKey: BashSignatureOptions = { names: { timeoutMs: "t" } };
