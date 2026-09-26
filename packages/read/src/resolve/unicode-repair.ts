import type { PathResolver } from "../contract/extensions.ts";
import { canonicalizeFileName } from "../suggest/canonicalize.ts";

/**
 * Lists the parent once. Returns the unique Unicode-equivalent name, else the
 * path unchanged. An exact match, several matches, or a failed listing leave
 * the path unchanged. Note default true.
 */
export function unicodeRepair(options: { note?: boolean } = {}): PathResolver<unknown> {
  const withNote = options.note ?? true;
  return Object.freeze({
    id: "unicode-repair",
    async resolve(path, ctx) {
      const dir = ctx.paths.dirname(path);
      const name = ctx.paths.basename(path);
      const listed = await ctx.list(dir);
      if (!listed.ok || listed.entries.some((entry) => entry.name === name)) {
        return { kind: "path", path };
      }
      const canonical = canonicalizeFileName(name);
      const matches = listed.entries.filter(
        (entry) => canonicalizeFileName(entry.name) === canonical,
      );
      const [match] = matches;
      if (matches.length !== 1 || match === undefined) return { kind: "path", path };
      const repaired = ctx.paths.join(dir, match.name);
      if (!withNote) return { kind: "path", path: repaired };
      return {
        kind: "path",
        path: repaired,
        note: {
          code: "path-repaired",
          severity: "warning",
          message: ctx.messages.pathRepaired({ from: path, to: repaired }),
          data: { from: path, to: repaired },
        },
      };
    },
  } satisfies PathResolver<unknown>);
}
