import { describe, expect, test } from "bun:test";

import { errorOf, codes, errorCode, harness, note, text } from "../helpers.ts";

const BOM = [0xef, 0xbb, 0xbf];
const encode = (value: string) => new TextEncoder().encode(value);

describe("write planning (section 5.6)", () => {
  test("create writes the content as given and reports the change", async () => {
    const { fs, write } = harness();
    const result = await write({ path: "/docs/notes.md", content: "one\r\ntwo\n" });
    expect(result.status).toBe("ok");
    expect(text(fs, "/docs/notes.md")).toBe("one\r\ntwo\n");
    const [change] = result.changes;
    expect(change).toMatchObject({
      kind: "create",
      path: "/docs/notes.md",
      requestedPath: "/docs/notes.md",
      resolvedPath: "/docs/notes.md",
      movedFrom: null,
      before: null,
      linesAdded: 2,
      linesRemoved: 0,
      matches: [],
      snippets: [],
      userModified: false,
      createdDirectories: ["/docs"],
    });
    expect(change?.after?.bytes).toBe(9);
    expect(change?.diff.startsWith("--- /dev/null\n+++ b/docs/notes.md\n")).toBe(true);
    expect(note(result, "directories-created")?.data).toEqual({ paths: ["/docs"] });
  });

  test("create with an existing parent reports no directories", async () => {
    const { write } = harness({ fsOptions: { directories: ["/src"] } });
    const result = await write({ path: "/src/a.ts", content: "x" });
    expect(result.changes[0]?.createdDirectories).toEqual([]);
    expect(codes(result)).not.toContain("directories-created");
  });

  test("replace needs a read and reports before and after", async () => {
    const { fs, read, write } = harness({ files: { "/a.ts": "a\nb\n" } });
    await read({ path: "/a.ts" });
    const before = fs.peek("/a.ts")?.version;
    const result = await write({ path: "/a.ts", content: "a\nB\nc\n" });
    expect(result.status).toBe("ok");
    const [change] = result.changes;
    expect(change?.kind).toBe("update");
    expect(change?.before).toMatchObject({ version: before, bytes: 4 });
    expect(change?.after).toMatchObject({ version: fs.peek("/a.ts")?.version, bytes: 6 });
    expect([change?.linesAdded, change?.linesRemoved]).toEqual([2, 1]);
    expect(text(fs, "/a.ts")).toBe("a\nB\nc\n");
  });

  test("a CRLF file keeps CRLF, and CRLF in the content is not doubled", async () => {
    const { fs, read, write } = harness({ files: { "/w.txt": "one\r\ntwo\r\n" } });
    await read({ path: "/w.txt" });
    const result = await write({ path: "/w.txt", content: "one\ntwo\r\nthree\n" });
    expect(result.status).toBe("ok");
    expect(text(fs, "/w.txt")).toBe("one\r\ntwo\r\nthree\r\n");
    // The diff is in LF text space.
    expect(result.changes[0]?.diff).toContain("+three\n");
  });

  test("a BOM survives a replace", async () => {
    const { fs, read, write } = harness({
      files: { "/b.txt": Uint8Array.of(...BOM, ...encode("x\n")) },
    });
    await read({ path: "/b.txt" });
    await write({ path: "/b.txt", content: "y\n" });
    expect([...(fs.peek("/b.txt")?.bytes ?? [])]).toEqual([...BOM, ...encode("y\n")]);
  });

  test("the same content is no-change and writes nothing", async () => {
    const { fs, read, write } = harness({ files: { "/c.txt": "a\r\nb\r\n" } });
    await read({ path: "/c.txt" });
    const version = fs.peek("/c.txt")?.version;
    const result = await write({ path: "/c.txt", content: "a\nb\n" });
    expect(result.status).toBe("no-change");
    expect(result.changes).toEqual([]);
    expect(result.unchanged).toEqual(["/c.txt"]);
    expect(fs.peek("/c.txt")?.version).toBe(version);
  });

  test("content over maxWriteBytes is TOO_LARGE, and the text suggests edit for an existing file", async () => {
    const { fs, read, write } = harness({
      files: { "/big.txt": "small\n" },
      deps: { limits: { maxWriteBytes: 4 } },
    });
    const create = await write({ path: "/new.txt", content: "12345" });
    expect(errorCode(create)).toBe("TOO_LARGE");
    expect(errorOf(create)?.phase).toBe("encode");
    expect(note(create, "too-large")?.message).not.toContain("edit tool");
    await read({ path: "/big.txt" });
    const replace = await write({ path: "/big.txt", content: "12345" });
    expect(errorCode(replace)).toBe("TOO_LARGE");
    expect(note(replace, "too-large")?.message).toContain("edit tool");
    expect(text(fs, "/big.txt")).toBe("small\n");
    expect(text(fs, "/new.txt")).toBeNull();
  });

  test("an empty content creates an empty file", async () => {
    const { fs, write } = harness();
    const result = await write({ path: "/empty", content: "" });
    expect(result.status).toBe("ok");
    expect(result.changes[0]?.linesAdded).toBe(0);
    expect(fs.peek("/empty")?.bytes.byteLength).toBe(0);
  });
});
