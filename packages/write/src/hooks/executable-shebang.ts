import type { WriteHook } from "../contract/extensions.ts";

/**
 * Creates a new file that starts with `#!` as executable, with `mode`
 * (default 0o755), and adds an info note when it worked. An existing file
 * keeps its mode, and a file with a BOM is left alone.
 */
export function executableShebang(options: { readonly mode?: number } = {}): WriteHook<unknown> {
  const { mode = 0o755 } = options;
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
    throw new TypeError("mode must be an integer from 0 to 0o7777");
  }
  const asked = new WeakMap<object, Set<string>>();
  return Object.freeze<WriteHook<unknown>>({
    id: "executable-shebang",
    newFileMode(change, ctx) {
      const after = change.after;
      if (change.kind !== "create" || after === null || after.style.bom) return null;
      if (!after.text.startsWith("#!")) return null;
      const paths = asked.get(ctx.call) ?? new Set<string>();
      paths.add(change.resolvedPath);
      asked.set(ctx.call, paths);
      return mode;
    },
    async afterWrite(change, ctx) {
      if (change.kind !== "create" || !asked.get(ctx.call)?.has(change.resolvedPath)) return {};
      const outcome = await ctx.fs.stat(change.resolvedPath, {});
      if (!outcome.ok || !outcome.stat.exists) return {};
      const actual = outcome.stat.mode;
      if (actual === null || (actual & 0o111) === 0) return {};
      return {
        notes: [
          {
            code: "executable",
            severity: "info",
            message: `Made ${change.path} executable (mode ${actual.toString(8)}) because it starts with "#!".`,
            data: { mode: actual },
          },
        ],
      };
    },
  });
}
