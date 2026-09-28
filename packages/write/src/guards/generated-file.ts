import type { Guard } from "../contract/extensions.ts";
import { ALLOW, refuse, regExpList } from "./shared.ts";

const DEFAULT_NAMES: readonly RegExp[] = [/\.min\./u, /\.generated\./u, /_pb2\.py$/u, /\.pb\.go$/u];
const DEFAULT_MARKERS: readonly RegExp[] = [/@generated\b/u, /DO NOT EDIT/u, /auto-generated/iu];

/** Characters of the before text searched for a marker. */
const HEAD = 1_024;

/**
 * Opt-in. Refuses an update to a file that looks generated (Oh My Pi): a
 * file name that matches one of `names`, or a marker in the first 1 024
 * characters of the file. A marker further down does not count. Creates
 * pass: the tool may be the generator.
 */
export function generatedFileGuard(
  options: { readonly markers?: readonly RegExp[]; readonly names?: readonly RegExp[] } = {},
): Guard<unknown> {
  const markers =
    options.markers === undefined ? DEFAULT_MARKERS : regExpList(options.markers, "markers");
  const names = options.names === undefined ? DEFAULT_NAMES : regExpList(options.names, "names");
  return Object.freeze<Guard<unknown>>({
    id: "generated-file",
    check(change) {
      if (change.before === null) return ALLOW;
      const path = change.resolvedPath;
      const reason =
        nameReason(names, path.slice(path.lastIndexOf("/") + 1)) ??
        markerReason(markers, change.before.text.slice(0, HEAD));
      if (reason === null) return ALLOW;
      return refuse(
        "generated-file",
        `${change.displayPath} looks generated: ${reason}. Change its source or generator instead, then regenerate it.`,
        { reason },
      );
    },
  });
}

function nameReason(names: readonly RegExp[], name: string): string | null {
  return names.some((pattern) => pattern.test(name))
    ? `its name, ${name}, is a generated-file name`
    : null;
}

function markerReason(markers: readonly RegExp[], head: string): string | null {
  for (const pattern of markers) {
    const match = pattern.exec(head);
    if (match !== null) return `its first lines hold "${match[0]}"`;
  }
  return null;
}
