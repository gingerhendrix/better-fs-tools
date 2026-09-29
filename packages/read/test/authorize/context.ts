import { defaultReadLimits, defaultReadMessages } from "../../src/index.ts";
import type { ReadAuthorizeTarget, ReadHookContext, ReadRequest } from "../../src/index.ts";

export function hookContext(request: Partial<ReadRequest> = {}): ReadHookContext<unknown> {
  return {
    tool: "read",
    request: { path: "/d/a.txt", offset: 1, limit: 2_000, ranged: false, ...request },
    limits: defaultReadLimits,
    messages: defaultReadMessages,
    digest: null,
    clock: () => new Date(0),
    call: { host: undefined },
  };
}

export function readTarget(resolvedPath: string, size: number | null = 10): ReadAuthorizeTarget {
  return {
    action: "read",
    requestedPath: resolvedPath,
    resolvedPath,
    displayPath: resolvedPath,
    size,
    mtimeMs: null,
  };
}

export function listTarget(dir: string): ReadAuthorizeTarget {
  return {
    action: "list",
    requestedPath: `${dir}/x`,
    resolvedPath: dir,
    displayPath: dir,
    size: null,
    mtimeMs: null,
  };
}
