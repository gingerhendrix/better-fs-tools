import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { FileSystem } from "@better-fs-tools/fs";

import { createReadTool, textOf } from "../../src/index.ts";
import type { ReadContext, SuggestContext } from "../../src/index.ts";
import { expectFailure, harness, spyFileSystem } from "../helpers.ts";

interface Host {
  readonly id: string;
}

describe("suggest on a miss", () => {
  test("one open per read, and a suggested name is never opened", async () => {
    const { fs, opens, lists } = spyFileSystem(
      memoryFileSystem({ files: { "/src/config.json": "{}\n", "/src/other.md": "x\n" } }),
    );
    const result = expectFailure(
      await createReadTool({ fs })({ path: "/src/config.jsan" }),
      "NOT_FOUND",
    );
    expect(opens).toEqual(["/src/config.jsan"]);
    expect(lists).toEqual(["/src"]);
    expect(result.notes[0]?.data).toEqual({ suggestions: ["config.json"] });
    expect(textOf(result)).toContain('Nearby names: "config.json"');
  });

  test("suggest: null never lists", async () => {
    const { fs, lists } = spyFileSystem(
      memoryFileSystem({ files: { "/src/config.json": "{}\n" } }),
    );
    const read = createReadTool({ fs, suggest: null });
    const result = expectFailure(await read({ path: "/src/config.jsan" }), "NOT_FOUND");
    expect(lists).toEqual([]);
    expect(result.notes[0]?.data).toBeUndefined();
  });

  test("a U+202F name missed with a plain space gives the equivalent name first", async () => {
    const { read } = harness({
      files: { "/d/report 2026.txt": "x\n", "/d/report-2026.txt": "y\n" },
    });
    const result = expectFailure(await read({ path: "/d/report 2026.txt" }), "NOT_FOUND");
    expect(result.notes[0]?.data?.suggestions).toEqual(["report 2026.txt", "report-2026.txt"]);
  });

  test("two equivalent names give two suggestions", async () => {
    const { read } = harness({ files: { "/d/a b.txt": "one\n", "/d/a b.txt": "two\n" } });
    const result = expectFailure(await read({ path: "/d/a b.txt" }), "NOT_FOUND");
    expect(result.notes[0]?.data?.suggestions).toEqual(["a b.txt", "a b.txt"]);
  });

  test("a truncated listing is disclosed in the note data", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 12; index += 1) files[`/many/file-${index}.txt`] = "x\n";
    const { read } = harness({ files, limits: { maxDirectoryEntries: 4 } });
    const result = expectFailure(await read({ path: "/many/missing.txt" }), "NOT_FOUND");
    expect(result.notes[0]?.data).toEqual({ entriesTruncated: true });
  });

  test("the result is cut to maxSuggestions", async () => {
    const { read } = harness({
      files: { "/d/a.ts": "", "/d/a.js": "", "/d/a.md": "" },
      limits: { maxSuggestions: 2 },
      deps: { suggest: () => ["a.ts", "a.js", "a.md"] },
    });
    const result = expectFailure(await read({ path: "/d/a.txt" }), "NOT_FOUND");
    expect(result.notes[0]?.data?.suggestions).toEqual(["a.ts", "a.js"]);
  });

  test("a backend with no list() gives a plain NOT_FOUND", async () => {
    const { read } = harness({ files: { "/d/a.ts": "" }, fsOptions: { list: false } });
    const result = expectFailure(await read({ path: "/d/a.tsx" }), "NOT_FOUND");
    expect(result.notes[0]?.data).toBeUndefined();
  });

  test("a throwing list() gives a plain NOT_FOUND", async () => {
    const inner = memoryFileSystem({ files: { "/d/a.ts": "" } });
    const fs: FileSystem = {
      ...inner,
      list: () => Promise.reject(new Error("socket closed")),
    };
    const result = expectFailure(await createReadTool({ fs })({ path: "/d/a.tsx" }), "NOT_FOUND");
    expect(result.notes[0]?.data).toBeUndefined();
  });

  test("a throwing suggest gives EXTENSION_FAILED in the open phase", async () => {
    const { read } = harness({
      files: { "/d/a.ts": "" },
      deps: {
        suggest: () => {
          throw new Error("secret detail");
        },
      },
    });
    const result = expectFailure(await read({ path: "/d/a.tsx" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({ extension: "suggest", phase: "open" });
    expect(textOf(result)).not.toContain("secret detail");
  });

  test("a malformed return gives EXTENSION_FAILED", async () => {
    for (const value of [null, "a.ts", [1], Promise.resolve(["a.ts"])]) {
      const { read } = harness({
        files: { "/d/a.ts": "" },
        deps: { suggest: () => value as never },
      });
      expectFailure(await read({ path: "/d/a.tsx" }), "EXTENSION_FAILED");
    }
  });

  test("suggest gets the caller's call object and the listing", async () => {
    const seen: SuggestContext<Host>[] = [];
    const fs = memoryFileSystem({ files: { "/d/a.ts": "" } });
    const read = createReadTool<Host>({
      fs,
      suggest: (ctx) => {
        seen.push(ctx);
        return [];
      },
    });
    const call: ReadContext<Host> = { host: { id: "h1" } };
    expectFailure(await read({ path: "/d/a.tsx" }, call), "NOT_FOUND");
    expect(seen).toHaveLength(1);
    const ctx = seen[0];
    expect(ctx?.call).toBe(call);
    expect(ctx).toMatchObject({
      path: "/d/a.tsx",
      name: "a.tsx",
      entries: [{ name: "a.ts", type: "file" }],
      entriesTruncated: false,
      max: 5,
    });
  });

  test("an abort during the listing gives ABORTED", async () => {
    const controller = new AbortController();
    const inner = memoryFileSystem({ files: { "/d/a.ts": "" } });
    const list = inner.list?.bind(inner);
    if (list === undefined) throw new Error("expected list()");
    const fs: FileSystem = {
      ...inner,
      list: (path, options) => {
        controller.abort();
        return list(path, options);
      },
    };
    const result = expectFailure(
      await createReadTool({ fs })({ path: "/d/a.tsx" }, { signal: controller.signal }),
      "ABORTED",
    );
    expect(result.notes[0]?.data).toEqual({ phase: "open" });
  });
});
