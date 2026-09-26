import type { PathResolver } from "../contract/extensions.ts";

const FILE_URL = "file://";

/** Strips "file://" (percent-decoded) and a leading "@". Both default true. */
export function stripPrefixes(
  options: { fileUrl?: boolean; at?: boolean } = {},
): PathResolver<unknown> {
  const fileUrl = options.fileUrl ?? true;
  const at = options.at ?? true;
  return Object.freeze({
    id: "strip-prefixes",
    resolve(path) {
      let next = path;
      if (fileUrl && next.startsWith(FILE_URL)) next = fromFileUrl(next) ?? next;
      if (at && next.length > 1 && next.startsWith("@")) next = next.slice(1);
      return { kind: "path", path: next };
    },
  } satisfies PathResolver<unknown>);
}

/** The path of a file URL, or null when it does not decode to a usable path. */
function fromFileUrl(url: string): string | null {
  let rest = url.slice(FILE_URL.length);
  if (rest.startsWith("localhost/")) rest = rest.slice("localhost".length);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return decoded.trim() === "" || decoded.includes("\0") ? null : decoded;
}
