import { posixPaths } from "@better-fs-tools/fs";
import type { DirectoryEntry, ListOutcome } from "@better-fs-tools/fs";

import { defaultLimits, defaultMessages } from "../../src/index.ts";
import type { ResolveContext } from "../../src/index.ts";

/** A resolve context over a fixed listing, for unit tests of one resolver. */
export function resolveContext(
  names: readonly string[] = [],
  lists: string[] = [],
): ResolveContext<unknown> {
  const entries: DirectoryEntry[] = names.map((name) => ({ name, type: "file" }));
  return {
    request: { path: "x", offset: 1, limit: 2_000, ranged: false },
    limits: defaultLimits,
    messages: defaultMessages,
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
