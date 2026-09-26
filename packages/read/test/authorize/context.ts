import { defaultLimits, defaultMessages } from "../../src/index.ts";
import type { AuthorizeTarget, HookContext, ReadRequest } from "../../src/index.ts";

/** A hook context for unit tests of one authorizer. */
export function hookContext(request: Partial<ReadRequest> = {}): HookContext<unknown> {
  return {
    request: { path: "/d/a.txt", offset: 1, limit: 2_000, ranged: false, ...request },
    limits: defaultLimits,
    messages: defaultMessages,
    digest: null,
    clock: () => new Date(0),
    call: { host: undefined },
  };
}

export function readTarget(resolvedPath: string, size: number | null = 10): AuthorizeTarget {
  return {
    action: "read",
    requestedPath: resolvedPath,
    resolvedPath,
    displayPath: resolvedPath,
    size,
    mtimeMs: null,
  };
}

export function listTarget(dir: string): AuthorizeTarget {
  return {
    action: "list",
    requestedPath: `${dir}/x`,
    resolvedPath: dir,
    displayPath: dir,
    size: null,
    mtimeMs: null,
  };
}
