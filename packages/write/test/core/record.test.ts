import { describe, expect, test } from "bun:test";

import { createReadTool, repeatReadGuard } from "@better-fs-tools/read";
import type { ReadStateStore } from "@better-fs-tools/read";

import { createWriteTool } from "../../src/index.ts";
import { FIXED_DATE, harness, testDigest } from "../helpers.ts";

describe("record (section 5.10)", () => {
  test("a commit stores a schema 2 write record", async () => {
    const { fs, state, digest, write } = harness();
    const result = await write({ path: "/a.txt", content: "hello\n" });
    const after = result.changes[0]?.after;
    const version = fs.peek("/a.txt")?.version ?? null;
    const contentId = after?.contentId ?? "";
    expect(await state.get("/a.txt")).toEqual({
      schema: 2,
      origin: "write",
      observationId: digest.hash(JSON.stringify(["write", "/a.txt", version, contentId])),
      resolvedPath: "/a.txt",
      identity: version,
      version,
      digest: "test-fnv",
      contentId,
      viewId: contentId,
      observedAt: FIXED_DATE.toISOString(),
      wholeFileVisible: true,
      totalsExact: true,
      request: null,
    });
  });

  test("the record's contentId is the read tool's hash of the same bytes", async () => {
    const { state, read, write } = harness();
    await write({ path: "/a.txt", content: "one\ntwo\n" });
    const written = await state.get("/a.txt");
    await read({ path: "/a.txt" });
    const readBack = await state.get("/a.txt");
    expect(readBack?.contentId).toBe(written?.contentId ?? null);
  });

  test("a second write needs no read", async () => {
    const { read, write } = harness({ files: { "/a.txt": "one\n" } });
    await read({ path: "/a.txt" });
    expect((await write({ path: "/a.txt", content: "two\n" })).status).toBe("ok");
    expect((await write({ path: "/a.txt", content: "three\n" })).status).toBe("ok");
  });

  test("the write record does not trip the read tool's repeat guard", async () => {
    const { write, state, fs } = harness();
    await write({ path: "/a.txt", content: "x\n" });
    const read = createReadTool({ fs, state, digest: testDigest(), hooks: [repeatReadGuard()] });
    const result = await read({ path: "/a.txt" });
    expect(result.status).toBe("ok");
    expect(result.notes.map((entry) => entry.code)).not.toContain("repeat-read");
    expect(result.status === "ok" && result.view.lines.map((line) => line.text)).toEqual(["x"]);
  });

  test("no-change stores nothing", async () => {
    const { state, read, write } = harness({ files: { "/a.txt": "one\n" } });
    await read({ path: "/a.txt" });
    const before = await state.get("/a.txt");
    await write({ path: "/a.txt", content: "one\n" });
    expect(await state.get("/a.txt")).toEqual(before);
  });

  test("a failing store never fails the call", async () => {
    const { fs } = harness();
    const store: ReadStateStore = {
      get: async () => null,
      put: async () => {
        throw new Error("store down");
      },
      delete: async () => {},
    };
    const write = createWriteTool({ fs, state: store, digest: testDigest() });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.status).toBe("ok");
    expect(result.notes).toEqual([]);
  });

  test("without a store nothing is recorded, and without a digest contentId is null", async () => {
    const { fs } = harness();
    const write = createWriteTool({ fs });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.changes[0]?.after?.contentId).toBeNull();
  });
});
