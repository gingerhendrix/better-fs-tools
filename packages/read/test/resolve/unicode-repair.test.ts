import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, textOf, unicodeRepair } from "../../src/index.ts";
import { expectFailure, expectOk, harness, note, spyFileSystem } from "../helpers.ts";
import { resolveContext } from "./context.ts";

describe("unicodeRepair", () => {
  test("repairs a unique equivalent name, with a path-repaired note", async () => {
    const lists: string[] = [];
    const ctx = resolveContext(["report 2026.txt", "other.txt"], lists);
    expect(await unicodeRepair().resolve("/d/report 2026.txt", ctx)).toEqual({
      kind: "path",
      path: "/d/report 2026.txt",
      note: {
        code: "path-repaired",
        severity: "warning",
        message:
          'The requested filename "/d/report 2026.txt" was repaired to the unique Unicode-equivalent path "/d/report 2026.txt".',
        data: { from: "/d/report 2026.txt", to: "/d/report 2026.txt" },
      },
    });
    expect(lists).toEqual(["/d"]);
  });

  test("keeps a relative path relative", async () => {
    const ctx = resolveContext(["café.txt"]);
    expect(await unicodeRepair({ note: false }).resolve("café.txt", ctx)).toEqual({
      kind: "path",
      path: "café.txt",
    });
  });

  test("an exact name, several equivalents, or no match leave the path unchanged", async () => {
    const resolver = unicodeRepair();
    const unchanged = { kind: "path", path: "/d/a b.txt" } as const;
    expect(await resolver.resolve("/d/a b.txt", resolveContext(["a b.txt", "a b.txt"]))).toEqual(
      unchanged,
    );
    expect(await resolver.resolve("/d/a b.txt", resolveContext(["a b.txt", "a b.txt"]))).toEqual(
      unchanged,
    );
    expect(await resolver.resolve("/d/a b.txt", resolveContext(["c.txt"]))).toEqual(unchanged);
  });

  test("a failed listing leaves the path unchanged", async () => {
    const ctx = {
      ...resolveContext(),
      list: async () => ({ ok: false, error: { reason: "denied" } }) as const,
    };
    expect(await unicodeRepair().resolve("/d/a b.txt", ctx)).toEqual({
      kind: "path",
      path: "/d/a b.txt",
    });
  });
});

describe("unicodeRepair through the tool", () => {
  test("a U+202F miss opens the real file, with path-repaired and resolvedFrom", async () => {
    const { fs, opens, lists } = spyFileSystem(
      memoryFileSystem({ files: { "/d/report 2026.txt": "hello\n" } }),
    );
    const read = createReadTool({ fs, resolve: unicodeRepair() });
    const result = expectOk(await read({ path: "/d/report 2026.txt" }));
    expect(opens).toEqual(["/d/report 2026.txt"]);
    expect(lists).toEqual(["/d"]);
    expect(result.file.requestedPath).toBe("/d/report 2026.txt");
    expect(result.file.resolvedPath).toBe("/d/report 2026.txt");
    expect(result.file.resolvedFrom).toBe("/d/report 2026.txt");
    expect(note(result, "path-repaired")?.severity).toBe("warning");
    expect(textOf(result)).toContain("[read:path-repaired]");
  });

  // Stored NFC, requested NFD.
  test("an NFD request for an NFC name is repaired", async () => {
    const { read } = harness({
      files: { "/dir/café.txt": "hello\n" },
      deps: { resolve: unicodeRepair() },
    });
    const result = expectOk(await read({ path: "/dir/café.txt" }));
    expect(result.file.resolvedPath).toBe("/dir/café.txt");
    expect(result.file.resolvedFrom).toBe("/dir/café.txt");
  });

  test("with note: false there is no note, and resolvedFrom is still set", async () => {
    const { read } = harness({
      files: { "/d/report 2026.txt": "hello\n" },
      deps: { resolve: unicodeRepair({ note: false }) },
    });
    const result = expectOk(await read({ path: "/d/report 2026.txt" }));
    expect(note(result, "path-repaired")).toBeUndefined();
    expect(result.file.resolvedFrom).toBe("/d/report 2026.txt");
  });

  test("two equivalent names refuse to guess and give two suggestions", async () => {
    const { fs, opens, lists } = spyFileSystem(
      memoryFileSystem({ files: { "/d/a b.txt": "one\n", "/d/a b.txt": "two\n" } }),
    );
    const read = createReadTool({ fs, resolve: unicodeRepair() });
    const result = expectFailure(await read({ path: "/d/a b.txt" }), "NOT_FOUND");
    expect(opens).toEqual(["/d/a b.txt"]);
    expect(lists).toEqual(["/d", "/d"]);
    expect(result.notes[0]?.data?.suggestions).toEqual(["a b.txt", "a b.txt"]);
  });

  test("an exact hit opens as requested with resolvedFrom null", async () => {
    const { read } = harness({
      files: { "/d/a.txt": "x\n" },
      deps: { resolve: unicodeRepair() },
    });
    const result = expectOk(await read({ path: "/d/a.txt" }));
    expect(result.file.resolvedFrom).toBeNull();
    expect(result.notes.map((entry) => entry.code)).not.toContain("path-repaired");
  });
});
