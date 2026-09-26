import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, directoryListing } from "../../src/index.ts";
import { expectOk, lineText, note } from "../helpers.ts";

function read(options: Parameters<typeof directoryListing>[0], limits = {}) {
  const fs = memoryFileSystem({
    files: {
      "/d/b.txt": "b",
      "/d/a.txt": "a",
      "/d/zeta/x.txt": "x",
      "/d/alpha/y.txt": "y",
      "/d/line\nbreak.txt": "n",
    },
    directories: ["/empty"],
  });
  return createReadTool({ fs, limits, converters: [directoryListing(options)] });
}

describe("directoryListing", () => {
  test("sorts by name by default, with no trailing slash", async () => {
    const result = expectOk(await read({})({ path: "/d" }));
    expect(lineText(result)).toEqual(["a.txt", "alpha", "b.txt", '"line\\nbreak.txt"', "zeta"]);
  });

  test("type-then-name puts directories first; trailingSlash marks them", async () => {
    const result = expectOk(
      await read({ sort: "type-then-name", trailingSlash: true })({ path: "/d" }),
    );
    expect(lineText(result)).toEqual(["alpha/", "zeta/", "a.txt", "b.txt", '"line\\nbreak.txt"']);
  });

  test("a cut listing has a note with the entry limit", async () => {
    const result = expectOk(await read({}, { maxDirectoryEntries: 2 })({ path: "/d" }));
    expect(result.view.lines).toHaveLength(2);
    expect(note(result, "directory-truncated")).toEqual({
      code: "directory-truncated",
      severity: "warning",
      message: "The listing of /d stopped at 2 entries; the directory has more.",
      data: { maxDirectoryEntries: 2 },
    });
  });

  test("an empty directory has a note", async () => {
    const result = expectOk(await read({})({ path: "/empty" }));
    expect(result.view.lines).toEqual([]);
    expect(note(result, "empty-directory")?.message).toBe("/empty is empty.");
  });

  test("rejects malformed options", () => {
    expect(() => directoryListing({ trailingSlash: "yes" as never })).toThrow(TypeError);
    expect(() => directoryListing({ sort: "size" as never })).toThrow(TypeError);
  });
});
