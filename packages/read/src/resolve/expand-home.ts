import type { PathResolver } from "../contract/base.ts";

/** Expands "~" and "~/x" to `home`. Other "~user" forms pass through unchanged. */
export function expandHome(options: { home: string }): PathResolver<unknown> {
  const home = options?.home;
  if (typeof home !== "string" || home === "") {
    throw new TypeError("expandHome needs a non-empty home");
  }
  return Object.freeze({
    id: "expand-home",
    resolve(path, ctx) {
      if (path === "~" || path === "~/") return { kind: "path", path: home };
      if (!path.startsWith("~/")) return { kind: "path", path };
      return { kind: "path", path: ctx.paths.join(home, path.slice(2)) };
    },
  } satisfies PathResolver<unknown>);
}
