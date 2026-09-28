import { describe, expect, test } from "bun:test";

import type { ReadRecord, ReadStateStore } from "@better-fs-tools/read";

import { createWriteTool } from "../../src/index.ts";
import { errorOf, codes, errorCode, harness, note, testDigest, text } from "../helpers.ts";

const FILE = { "/a.txt": "one\ntwo\nthree\n" };

describe("precondition table for write (section 5.3)", () => {
  test("row 1: a missing target is created with absent", async () => {
    const { fs, write } = harness();
    const result = await write({ path: "/new.txt", content: "x" });
    expect(result.status).toBe("ok");
    expect(text(fs, "/new.txt")).toBe("x");
  });

  test("row 2: requireRead off goes on without a record", async () => {
    const { fs, write } = harness({
      files: FILE,
      deps: { preconditions: { requireRead: "off" } },
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.status).toBe("ok");
    expect(codes(result)).not.toContain("read-before-write-off");
    expect(text(fs, "/a.txt")).toBe("x");
  });

  test("row 3: no store goes on with a read-before-write-off note", async () => {
    const { fs, write } = harness({ files: FILE, deps: { state: null } });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.status).toBe("ok");
    expect(note(result, "read-before-write-off")).toMatchObject({ severity: "warning" });
    expect(text(fs, "/a.txt")).toBe("x");
  });

  test("row 3: a state factory that returns null is the same", async () => {
    const { write } = harness({ files: FILE, deps: { state: () => null } });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.status).toBe("ok");
    expect(codes(result)).toContain("read-before-write-off");
  });

  test("row 3: a create with no store has no note", async () => {
    const { write } = harness({ deps: { state: null } });
    expect(codes(await write({ path: "/n.txt", content: "x" }))).toEqual([]);
  });

  test("row 4: no record is NOT_READ and nothing is opened or written", async () => {
    const { fs, write } = harness({ files: FILE });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "NOT_READ",
      phase: "precondition",
    });
    expect(textOfNotes(result)).toEqual([
      "[not-read] Read /a.txt with the read tool before changing it.",
    ]);
    expect(text(fs, "/a.txt")).toBe(FILE["/a.txt"]);
  });

  test("row 5: a partial read is NOT_READ with wholeFile for write", async () => {
    const { fs, read, write } = harness({ files: FILE });
    await read({ path: "/a.txt", offset: 2, limit: 1 });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "NOT_READ",
      phase: "precondition",
      data: { wholeFile: true },
    });
    expect(note(result, "not-read")?.message).toContain("A partial read is not enough");
    expect(text(fs, "/a.txt")).toBe(FILE["/a.txt"]);
  });

  test("row 5: partialRead always lets write use a partial read", async () => {
    const { read, write } = harness({
      files: FILE,
      deps: { preconditions: { partialRead: "always" } },
    });
    await read({ path: "/a.txt", offset: 2, limit: 1 });
    expect((await write({ path: "/a.txt", content: "x" })).status).toBe("ok");
  });

  test("row 6: fresh by version on a backend with identity", async () => {
    const { read, write } = harness({ files: FILE });
    await read({ path: "/a.txt" });
    expect((await write({ path: "/a.txt", content: "x" })).status).toBe("ok");
  });

  test("row 6: fresh by content hash after a touch with the same bytes", async () => {
    const { fs, read, write } = harness({ files: FILE });
    await read({ path: "/a.txt" });
    // Same bytes, new version: a touch.
    fs.setFile("/a.txt", FILE["/a.txt"]);
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.status).toBe("ok");
  });

  test("row 6: without identity the version alone is not trusted, the content hash is", async () => {
    const { fs, read, write } = harness({ files: FILE, fsOptions: { identity: "none" } });
    await read({ path: "/a.txt" });
    expect((await write({ path: "/a.txt", content: "x" })).status).toBe("ok");
    // The write record's hash keeps the next write fresh too.
    expect((await write({ path: "/a.txt", content: "y" })).status).toBe("ok");
    expect(text(fs, "/a.txt")).toBe("y");
  });

  test("row 7: not fresh with onStale rematch is STALE for write", async () => {
    const { fs, read, write } = harness({ files: FILE });
    await read({ path: "/a.txt" });
    fs.setFile("/a.txt", "someone else\n");
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "STALE",
      phase: "precondition",
    });
    expect(note(result, "stale")?.message).toBe(
      "/a.txt changed since it was last read. Read it again, then retry.",
    );
    expect(text(fs, "/a.txt")).toBe("someone else\n");
  });

  test("row 8: not fresh with onStale reject is STALE", async () => {
    const { fs, read, write } = harness({
      files: FILE,
      deps: { preconditions: { onStale: "reject" } },
    });
    await read({ path: "/a.txt" });
    fs.setFile("/a.txt", "changed\n");
    expect(errorCode(await write({ path: "/a.txt", content: "x" }))).toBe("STALE");
  });
});

describe("records that count as absent", () => {
  const record = (overrides: Partial<ReadRecord>): ReadRecord => ({
    schema: 2,
    origin: "read",
    observationId: "o",
    resolvedPath: "/a.txt",
    identity: null,
    version: null,
    digest: "test-fnv",
    contentId: null,
    viewId: "v",
    observedAt: "2026-09-28T00:00:00.000Z",
    wholeFileVisible: true,
    totalsExact: true,
    request: null,
    ...overrides,
  });

  /** A write tool over FILE whose store returns `stored` (or runs `get`). */
  async function writeWith(stored: (version: string) => unknown, get?: ReadStateStore["get"]) {
    const { fs } = harness({ files: FILE });
    const version = fs.peek("/a.txt")?.version ?? "";
    const store: ReadStateStore = {
      get: get ?? (async () => stored(version) as ReadRecord),
      put: async () => {},
      delete: async () => {},
    };
    return createWriteTool({ fs, state: store, digest: testDigest() });
  }

  test("a record made by another digest", async () => {
    const write = await writeWith((version) => record({ version, digest: "sha-256" }));
    expect(errorCode(await write({ path: "/a.txt", content: "x" }))).toBe("NOT_READ");
  });

  test("a schema 1 record", async () => {
    const write = await writeWith((version) => ({ ...record({ version }), schema: 1 }));
    expect(errorCode(await write({ path: "/a.txt", content: "x" }))).toBe("NOT_READ");
  });

  test("a failing get", async () => {
    const write = await writeWith(
      () => null,
      async () => {
        throw new Error("store down");
      },
    );
    expect(errorCode(await write({ path: "/a.txt", content: "x" }))).toBe("NOT_READ");
  });

  test("the same record with the current digest is fresh", async () => {
    const write = await writeWith((version) => record({ version }));
    expect((await write({ path: "/a.txt", content: "x" })).status).toBe("ok");
  });
});

function textOfNotes(result: { readonly notes: readonly { code: string; message: string }[] }) {
  return result.notes.map((entry) => `[${entry.code}] ${entry.message}`);
}
