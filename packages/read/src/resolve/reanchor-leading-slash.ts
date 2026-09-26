import type { PathResolver } from "../contract/extensions.ts";

/**
 * "/src/x.ts" to "src/x.ts" when "/src" is missing and "src" exists under the
 * tool root. The host's `firstSegmentExists` makes that call: it should return
 * true only for a segment that exists under the tool root and not at "/".
 */
export function reanchorLeadingSlash(options: {
  firstSegmentExists: (segment: string) => boolean;
}): PathResolver<unknown> {
  const exists = options?.firstSegmentExists;
  if (typeof exists !== "function") {
    throw new TypeError("reanchorLeadingSlash needs a firstSegmentExists function");
  }
  return Object.freeze({
    id: "reanchor-leading-slash",
    resolve(path) {
      if (!path.startsWith("/") || path.startsWith("//")) return { kind: "path", path };
      const rest = path.slice(1);
      const segment = rest.split("/", 1)[0] ?? "";
      if (segment === "" || !exists(segment)) return { kind: "path", path };
      return { kind: "path", path: rest };
    },
  } satisfies PathResolver<unknown>);
}
