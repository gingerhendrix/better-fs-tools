/**
 * Type tests for createFsTools. `tsc -b` checks this file; Bun never runs it.
 */
import { memoryFileSystem } from "@better-fs-tools/fs";
import { shellEnv } from "@better-fs-tools/shell";
import type { BashTool, CommandRunner } from "@better-fs-tools/shell";

import { createFsTools } from "../../src/index.ts";

declare const runner: CommandRunner;
const fs = memoryFileSystem();

// Without bash options, bash is null in the type.
const files = createFsTools({ fs });
// @ts-expect-error: bash may be null.
export const noBash: BashTool = files.bash;

// With a bash options object, bash is there.
const withBash = createFsTools({ fs, bash: { runner, env: shellEnv() } });
export const bash: BashTool = withBash.bash;

// The portable bundle has no default runner or env.
// @ts-expect-error: bash: true needs a host default.
createFsTools({ fs, bash: true });
// @ts-expect-error: env is required, as in the core.
createFsTools({ fs, bash: { runner } });

// Shared keys are set once, at the top level.
// @ts-expect-error: a tool cannot set its own state.
createFsTools({ fs, read: { state: null } });
// @ts-expect-error: bash gets the bundle's digest.
createFsTools({ fs, bash: { runner, env: shellEnv(), digest: null } });

// A digest is never null, so state needs no pairing here.
export const noDigest = createFsTools({ fs, state: null });
