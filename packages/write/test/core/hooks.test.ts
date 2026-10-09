import { describe, expect, test } from "bun:test";

import type { FileChange, WriteHook } from "../../src/index.ts";
import { errorOf, codes, harness, note, text } from "../helpers.ts";

describe("after-write hooks", () => {
  test("hooks run in order after the commit and see the change and the call's fs", async () => {
    const seen: string[] = [];
    const hook = (id: string): WriteHook<unknown> => ({
      id,
      afterWrite: async (change, ctx) => {
        const opened = await ctx.fs.open(change.resolvedPath, {});
        seen.push(`${id}:${change.kind}:${opened.ok}`);
        return { notes: [{ code: id, severity: "info", message: id }] };
      },
    });
    const { write } = harness({ deps: { hooks: [hook("one"), hook("two")] } });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(seen).toEqual(["one:create:true", "two:create:true"]);
    expect(codes(result)).toEqual(["one", "two"]);
  });

  test("a failing hook adds no note and the status stays ok", async () => {
    const { fs, write } = harness({
      deps: {
        hooks: [
          {
            id: "lint",
            afterWrite: () => {
              throw new Error("lint crashed");
            },
          },
          { id: "garbage", afterWrite: () => ({ rewrote: "yes" }) as never },
        ],
      },
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.status).toBe("ok");
    expect(result.notes).toEqual([]);
    expect(result.changes.map((change) => [change.kind, change.path])).toEqual([
      ["create", "/a.txt"],
    ]);
    expect(text(fs, "/a.txt")).toBe("x");
  });

  test("a rewrite is read back: change.after and the record use the new bytes", async () => {
    const formatter: WriteHook<unknown> = {
      id: "prettier",
      afterWrite: async (change, ctx) => {
        const stat = await ctx.fs.stat(change.resolvedPath, {});
        if (!stat.ok || !stat.stat.exists) throw new Error("gone");
        await ctx.fs.write(change.resolvedPath, new TextEncoder().encode("formatted\n"), {
          precondition: { kind: "version", version: stat.stat.version },
          createParents: false,
        });
        return { rewrote: true };
      },
    };
    const { fs, state, write } = harness({ deps: { hooks: [formatter] } });
    const result = await write({ path: "/a.txt", content: "raw" });
    const [change] = result.changes as FileChange[];
    expect(change?.after?.version).toBe(fs.peek("/a.txt")?.version);
    expect(change?.after?.bytes).toBe(10);
    expect(note(result, "hook-rewrote")?.data).toEqual({ hook: "prettier" });
    const record = await state.get("/a.txt");
    expect(record?.version).toBe(fs.peek("/a.txt")?.version);
    expect(record?.contentId).toBe(change?.after?.contentId ?? null);
    expect(record?.wholeFileVisible).toBe(false);
    const again = await write({ path: "/a.txt", content: "again" });
    expect(errorOf(again)).toMatchObject({ code: "NOT_READ", data: { wholeFile: true } });
  });

  test("a rewrite the core cannot read back deletes the record", async () => {
    const { fs, state, read, write } = harness({
      files: { "/a.txt": "one\n" },
      deps: {
        hooks: [
          {
            id: "eraser",
            afterWrite: () => {
              fs.deleteFile("/a.txt");
              return { rewrote: true };
            },
          },
        ],
      },
    });
    await read({ path: "/a.txt" });
    const result = await write({ path: "/a.txt", content: "two\n" });
    expect(result.status).toBe("ok");
    expect(result.changes[0]?.after).toEqual({ contentId: null, version: null, bytes: 0 });
    expect(await state.get("/a.txt")).toBeNull();
  });
});

describe("newFileMode", () => {
  const modeHook = (id: string, mode: () => unknown, seen: string[] = []): WriteHook<unknown> => ({
    id,
    newFileMode: (change) => {
      seen.push(`${id}:${change.kind}`);
      return mode() as number | null;
    },
    afterWrite: () => ({}),
  });

  test("the first hook that returns a number sets the mode of a create", async () => {
    const seen: string[] = [];
    const { fs, write } = harness({
      deps: {
        hooks: [
          modeHook("none", () => null, seen),
          modeHook("first", () => 0o600, seen),
          modeHook("second", () => 0o777, seen),
        ],
      },
    });
    expect((await write({ path: "/a.txt", content: "a" })).status).toBe("ok");
    expect(fs.peek("/a.txt")?.mode).toBe(0o600);
    expect(seen).toEqual(["none:create", "first:create"]);
  });

  test("a replace and an edit do not ask", async () => {
    const seen: string[] = [];
    const { read, write, edit } = harness({
      files: { "/a.txt": "a\n" },
      deps: { hooks: [modeHook("h", () => 0o600, seen)] },
    });
    await read({ path: "/a.txt" });
    await write({ path: "/a.txt", content: "b\n" });
    await edit({ path: "/a.txt", edits: [{ oldText: "b", newText: "c" }] });
    expect(seen).toEqual([]);
  });

  test.each([
    [
      "a throw",
      () => {
        throw new Error("boom");
      },
    ],
    ["a value out of range", () => 0o10000],
    ["a string", () => "755"],
  ])("%s gives EXTENSION_FAILED before anything is written", async (_name, mode) => {
    const { fs, write } = harness({ deps: { hooks: [modeHook("bad", mode)] } });
    const result = await write({ path: "/a.txt", content: "a" });
    expect(errorOf(result)).toMatchObject({
      code: "EXTENSION_FAILED",
      phase: "commit",
      data: { extension: "hooks", id: "bad" },
    });
    expect(text(fs, "/a.txt")).toBeNull();
  });
});
