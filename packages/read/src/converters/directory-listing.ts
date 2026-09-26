import type { DirectoryEntry } from "@better-fs-tools/fs";

import type { DirectoryConverter } from "../contract/extensions.ts";
import type { ReadNote } from "../contract/result.ts";

export interface DirectoryListingOptions {
  /** Add "/" after directory names. Default false. */
  trailingSlash?: boolean;
  /** Default "name". "type-then-name" puts directories first, then files, then others. */
  sort?: "name" | "type-then-name";
}

const TYPE_ORDER: Readonly<Record<DirectoryEntry["type"], number>> = {
  directory: 0,
  file: 1,
  other: 2,
};

/**
 * One entry per line. The core scans the lines, so offset, limit, and
 * continuation page over entries. The listing holds at most
 * limits.maxDirectoryEntries entries; a cut listing has a note.
 */
export function directoryListing(
  options: DirectoryListingOptions = {},
): DirectoryConverter<unknown> {
  const trailingSlash = options.trailingSlash ?? false;
  const sort = options.sort ?? "name";
  if (typeof trailingSlash !== "boolean") {
    throw new TypeError("directoryListing trailingSlash must be a boolean");
  }
  if (sort !== "name" && sort !== "type-then-name") {
    throw new TypeError('directoryListing sort must be "name" or "type-then-name"');
  }
  return Object.freeze<DirectoryConverter<unknown>>({
    id: "directory-listing",
    target: "directory",
    async convert(input, ctx) {
      const path = input.target?.displayPath ?? input.path;
      const listed = await input.list();
      // The core reports a failed listing itself; this refusal is never shown.
      if (!listed.ok) {
        return {
          kind: "refuse",
          code: "LIST_FAILED",
          note: { code: "list-failed", severity: "warning", message: `${path} was not listed.` },
        };
      }
      const entries = [...listed.entries].sort(sort === "name" ? byName : byTypeThenName);
      const notes: ReadNote[] = [];
      if (listed.truncated) {
        const limit = ctx.limits.maxDirectoryEntries;
        notes.push({
          code: "directory-truncated",
          severity: "warning",
          message: `The listing of ${path} stopped at ${limit} entries; the directory has more.`,
          data: { maxDirectoryEntries: limit },
        });
      } else if (entries.length === 0) {
        notes.push({ code: "empty-directory", severity: "info", message: `${path} is empty.` });
      }
      const lines = entries.map((entry) => {
        const name = /[\r\n]/u.test(entry.name) ? JSON.stringify(entry.name) : entry.name;
        return trailingSlash && entry.type === "directory" ? `${name}/` : name;
      });
      return { kind: "text", text: lines.join("\n"), mimeType: "text/plain", notes };
    },
  });
}

function byName(a: DirectoryEntry, b: DirectoryEntry): number {
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

function byTypeThenName(a: DirectoryEntry, b: DirectoryEntry): number {
  return TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || byName(a, b);
}
