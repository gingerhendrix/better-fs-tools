/**
 * Type tests. `tsc -b` checks this file through the package tsconfig. Bun never
 * runs it: the name does not match Bun's test file pattern.
 */
import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, jsonFormatter, lineNumberFormatter } from "../../src/index.ts";
import type {
  Dependencies,
  FormatContext,
  Formatter,
  ReadContext,
  ReadStateStore,
  ReadTool,
} from "../../src/index.ts";
import { createMemoryStore } from "../../src/state/index.ts";

declare const plain: ReadTool<undefined>;
declare const hosted: ReadTool<{ id: string }>;
declare const maybeHosted: ReadTool<{ id: string } | undefined>;

// ReadTool<undefined> accepts a call with no context, or a context without host.
void plain({ path: "a.ts" });
void plain({ path: "a.ts" }, { signal: new AbortController().signal, callId: "c1" });

// ReadTool<{ id: string }> needs a context with host.
// @ts-expect-error a host-typed tool rejects a call with no context
void hosted({ path: "a.ts" });
// @ts-expect-error a host-typed tool rejects a context without host
void hosted({ path: "a.ts" }, {});
// @ts-expect-error host has the wrong type
void hosted({ path: "a.ts" }, { host: { id: 1 } });
void hosted({ path: "a.ts" }, { host: { id: "session" } });

// A host type that includes undefined keeps the context optional.
void maybeHosted({ path: "a.ts" });

// The canonical input is checked at compile time too.
// @ts-expect-error aliases are not canonical input
void plain({ file_path: "a.ts" });

// createReadTool infers the host type from the fs factory's parameter annotation.
const fs = memoryFileSystem();
export const typed: ReadTool<{ id: string }> = createReadTool({
  fs: (call: ReadContext<{ id: string }>) => {
    const id: string = call.host.id;
    void id;
    return fs;
  },
});

// Host-free helpers typed with unknown fit a tool with any host type.
export const withHost = createReadTool<{ id: string }>({
  fs,
  formatter: lineNumberFormatter(),
});
export const withoutHost = createReadTool({ fs, formatter: jsonFormatter() });
export const unknownFits: Formatter<{ id: string }> = lineNumberFormatter();
declare const hostContext: FormatContext<{ id: string }>;
export const widened: FormatContext<unknown> = hostContext;
declare const unknownContext: FormatContext<unknown>;
// @ts-expect-error an unknown host is not a { id: string } host
export const narrowed: FormatContext<{ id: string }> = unknownContext;

// The state factory sees the typed host. A host-free store fits any tool.
const stores = new Map<string, ReadStateStore>();
export const hostState = createReadTool<{ id: string }>({
  fs,
  state: (call) => stores.get(call.host.id) ?? null,
});
export const sharedState = createReadTool<{ id: string }>({ fs, state: createMemoryStore() });
export const unknownState: Dependencies<{ id: string }>["state"] = (
  _call: ReadContext<unknown>,
): ReadStateStore | null => null;
createReadTool<{ id: string }>({
  fs,
  // @ts-expect-error the host has no session field
  state: (call) => stores.get(call.host.session) ?? null,
});
