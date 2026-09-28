import type { WriteHook } from "../contract/extensions.ts";

/**
 * Makes a new file that starts with `#!` executable (Oh My Pi). It asks
 * for `mode` (default 0o755) through `newFileMode`, so the create itself
 * sets the mode: there is no second write. After the commit it stats the
 * file and adds an info note when the backend reports execute bits. A
 * backend without modes gets no note. A replace keeps the file's mode, and
 * a file with a BOM is left alone, since the kernel would not see the `#!`.
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
