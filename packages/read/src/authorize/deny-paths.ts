import type { ToolAuthorizer } from "../contract/base.ts";
import { compileGlob } from "./glob.ts";
import { ALLOW, deny } from "./shared.ts";

/**
 * Denies any action, in any tool, on a resolvedPath that matches one of the
 * globs ("**", "*", "?"). For a read the resolvedPath is the realpath, so a
 * symlink to a denied file is denied.
 */
export function denyPaths(patterns: readonly string[]): ToolAuthorizer<unknown> {
  if (
    !Array.isArray(patterns) ||
    !patterns.every((pattern) => typeof pattern === "string" && pattern !== "")
  ) {
    throw new TypeError("denyPaths takes an array of non-empty glob strings");
  }
  const compiled = patterns.map((pattern) => ({ pattern, test: compileGlob(pattern) }));
  return Object.freeze({
    id: "deny-paths",
    authorize(target, ctx) {
      const hit = compiled.find((entry) => entry.test(target.resolvedPath));
      if (hit === undefined) return ALLOW;
      return deny(ctx, target, "the path matches a denied pattern", {
        data: { pattern: hit.pattern },
      });
    },
  } satisfies ToolAuthorizer<unknown>);
}
