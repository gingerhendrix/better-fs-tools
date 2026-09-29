import { posixPaths } from "@better-fs-tools/fs";
import type { DirectoryEntry, ListOutcome } from "@better-fs-tools/fs";

import { defaultReadLimits, defaultReadMessages } from "../../src/index.ts";
import type { ReadResolveContext } from "../../src/index.ts";

export function resolveContext(
  names: readonly string[] = [],
  lists: string[] = [],
): ReadResolveContext<unknown> {
  const entries: DirectoryEntry[] = names.map((name) => ({ name, type: "file" }));
  return {
    tool: "read",
    request: { path: "x", offset: 1, limit: 2_000, ranged: false },
    limits: defaultReadLimits,
    messages: defaultReadMessages,
    digest: null,
    clock: () => new Date(0),
    call: { host: undefined },
    paths: posixPaths,
    async list(dir): Promise<ListOutcome> {
      lists.push(dir);
      return { ok: true, entries, truncated: false };
    },
  };
}
