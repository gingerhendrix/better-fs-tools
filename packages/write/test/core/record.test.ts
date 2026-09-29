import { describe, expect, test } from "bun:test";

import { createReadTool, repeatReadGuard } from "@better-fs-tools/read";
import type { ReadStateStore } from "@better-fs-tools/read";

import { createEditTool, createWriteTool } from "../../src/index.ts";
import type { WriteAuthorizer, WriteHook } from "../../src/index.ts";
import { errorOf, FIXED_DATE, errorCode, harness, testDigest, text } from "../helpers.ts";

describe("record", () => {
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

  test("an edit keeps the previous record's wholeFileVisible", async () => {
    const { read, edit, state } = harness({ files: { "/a.txt": "one\n" } });
    await read({ path: "/a.txt" });
    await edit({ path: "/a.txt", edits: [{ oldText: "one", newText: "two" }] });
    expect(await state.get("/a.txt")).toMatchObject({ origin: "write", wholeFileVisible: true });
  });
});

describe("records for bytes the model has not seen", () => {
  const userContent: WriteAuthorizer<unknown> = {
    id: "user",
    authorize: (target) =>
      target.change === null ? { allow: true } : { allow: true, content: "user text\n" },
  };
  const rewriter: WriteHook<unknown> = {
    id: "fmt",
    afterWrite: async (change, ctx) => {
      await ctx.fs.write(change.resolvedPath, new TextEncoder().encode("formatted\n"), {
        precondition: { kind: "any" },
        createParents: false,
      });
      return { rewrote: true };
    },
  };

  test.each([
    ["authorizer content", { authorize: userContent }, "user-modified"],
    ["a hook rewrite", { hooks: [rewriter] }, "hook-rewrote"],
  ])(
    "after %s the record is not whole: edit works, write needs a whole read",
    async (_name, deps, code) => {
      const { read, write, fs, state } = harness({ files: { "/a.txt": "one\n" }, deps });
      await read({ path: "/a.txt" });
      const first = await write({ path: "/a.txt", content: "mine\n" });
      expect(first.notes.map((entry) => entry.code)).toContain(code);
      expect(await state.get("/a.txt")).toMatchObject({ origin: "write", wholeFileVisible: false });

      const plain = createEditTool({ fs, state, digest: testDigest(), clock: () => FIXED_DATE });
      const current = text(fs, "/a.txt") ?? "";
      const edited = await plain({
        path: "/a.txt",
        edits: [{ oldText: current, newText: "edited\n" }],
      });
      expect(edited.status).toBe("ok");

      const plainWrite = createWriteTool({ fs, state, digest: testDigest() });
      const replaced = await plainWrite({ path: "/a.txt", content: "again\n" });
      expect(errorOf(replaced)).toMatchObject({ code: "NOT_READ", data: { wholeFile: true } });
      expect(text(fs, "/a.txt")).toBe("edited\n");
    },
  );

  test("the same rules hold for edit: authorizer content on an edit leaves a partial record", async () => {
    const { read, edit, write, state } = harness({
      files: { "/a.txt": "one\n" },
      deps: { authorize: userContent },
    });
    await read({ path: "/a.txt" });
    await edit({ path: "/a.txt", edits: [{ oldText: "one", newText: "two" }] });
    expect((await state.get("/a.txt"))?.wholeFileVisible).toBe(false);
    expect(errorCode(await write({ path: "/a.txt", content: "x" }))).toBe("NOT_READ");
  });

  test("a create that a hook rewrote needs a read before write", async () => {
    const { write, state } = harness({ deps: { hooks: [rewriter] } });
    await write({ path: "/n.txt", content: "raw" });
    expect((await state.get("/n.txt"))?.wholeFileVisible).toBe(false);
    expect(errorCode(await write({ path: "/n.txt", content: "again" }))).toBe("NOT_READ");
  });
});
