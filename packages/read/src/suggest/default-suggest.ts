import type { Suggest } from "../contract/extensions.ts";
import { canonicalizeFileName } from "./canonicalize.ts";
import { suggestFileNames } from "./suggest-file-names.ts";

/** suggestFileNames, with Unicode-equivalent names ranked first. */
export function defaultSuggest(): Suggest<unknown> {
  return (ctx) => {
    const names = ctx.entries.map((entry) => entry.name);
    const canonical = canonicalizeFileName(ctx.name);
    const equivalent = names.filter(
      (name) => name !== ctx.name && canonicalizeFileName(name) === canonical,
    );
    const near = suggestFileNames(ctx.name, names, ctx.max);
    return [...new Set([...equivalent, ...near])].slice(0, ctx.max);
  };
}
