/**
 * Type tests for the write tool, its dependencies, and its extension points.
 * `tsc -b` checks this file; Bun never runs it.
 */
import { memoryFileSystem } from "@better-fs-tools/fs";
import type { WritableFileSystem } from "@better-fs-tools/fs";
import { denyPaths, expandHome, unicodeRepair } from "@better-fs-tools/read";
import type {
  Digest,
  ReadAuthorizer,
  ReadStateStore,
  ToolAuthorizer,
  ToolCallContext,
} from "@better-fs-tools/read";

import {
  askBeforeWrite,
  createWriteTool,
  defaultGuards,
  defaultWriteFormatter,
  executableShebang,
  generatedFileGuard,
  memoryLocks,
  protectPaths,
  syntaxGuard,
  utf8Codec,
  verifyWrite,
  writeAuthorizers,
} from "../../src/index.ts";
import type {
  Guard,
  MutationResult,
  WriteAuthorizer,
  WriteHook,
  WriteTool,
  WriteToolDeps,
} from "../../src/index.ts";

interface Host {
  readonly id: string;
}

const fs = memoryFileSystem();

// No host: ctx and host are optional.
export const plain: WriteTool = createWriteTool({ fs });
export const called: Promise<MutationResult> = plain({ path: "a", content: "b" });
export const withSignal: Promise<MutationResult> = plain(
  { path: "a", content: "b" },
  { signal: AbortSignal.abort() },
);

// With a host: ctx and host are required.
export const hosted: WriteTool<Host> = createWriteTool<Host>({ fs });
export const hostedCall: Promise<MutationResult> = hosted(
  { path: "a", content: "b" },
  { host: { id: "h" } },
);
// @ts-expect-error: a host tool needs its context.
export const missingHost = hosted({ path: "a", content: "b" });

// Read's tool-neutral helpers fit the write tool with any host.
export const neutral: ToolAuthorizer<unknown> = denyPaths(["**/.env"]);
export const asWriteAuthorizer: WriteAuthorizer<Host> = denyPaths(["**/.env"]);
export const deps: WriteToolDeps<Host> = {
  fs: (call: ToolCallContext<Host>) => (call.host.id === "" ? fs : fs),
  resolve: expandHome({ home: "/home" }),
  authorize: writeAuthorizers(
    denyPaths(["**/.env"]),
    askBeforeWrite(async (plan, ctx) => plan.length > 0 && ctx.call.host.id !== ""),
  ),
  codecs: [utf8Codec()],
  locks: memoryLocks({ timeoutMs: 1_000 }),
  formatter: defaultWriteFormatter({ diff: true }),
};
export const repaired: WriteToolDeps = { fs, resolve: unicodeRepair() };

// Built-in helpers typed on unknown fit any host.
const guard: Guard<unknown> = { id: "g", check: () => ({ allow: true }) };
const hook: WriteHook<unknown> = { id: "h", afterWrite: () => ({}) };
export const extended = createWriteTool<Host>({ fs, guards: [guard], hooks: [hook] });
export const builtIns = createWriteTool<Host>({
  fs,
  guards: [...defaultGuards(), generatedFileGuard(), syntaxGuard({ parsers: { yaml: () => {} } })],
  hooks: [verifyWrite(), executableShebang()],
  authorize: writeAuthorizers(
    protectPaths({
      ask: async (target, ctx) => target.tool === "write" && ctx.call.host.id !== "",
    }),
  ),
});
export const protectedPaths: WriteAuthorizer<Host> = protectPaths();
export const badMode: WriteHook<unknown> = {
  id: "m",
  // @ts-expect-error: newFileMode returns a number or null.
  newFileMode: () => "755",
  afterWrite: () => ({}),
};

// A write authorizer sees the change; a read authorizer does not fit write.
export const sees: WriteAuthorizer<Host> = {
  id: "sees",
  authorize: (target, ctx) =>
    target.change?.after?.text.includes(ctx.call.host.id) === true
      ? { allow: true, content: "replaced" }
      : { allow: false },
};
declare const readOnly: ReadAuthorizer<Host>;
// @ts-expect-error: the ReadAuthorizer target has size and mtimeMs, which write targets lack.
export const notWrite: WriteAuthorizer<Host> = readOnly;

// A state needs a digest (StateNeedsDigest), in the write tools as in read.
declare const pairedFs: WritableFileSystem;
declare const pairedStore: ReadStateStore;
declare const pairedDigest: Digest;
// @ts-expect-error a state without a digest
createWriteTool({ fs: pairedFs, state: pairedStore });
export const paired = createWriteTool({ fs: pairedFs, state: pairedStore, digest: pairedDigest });
