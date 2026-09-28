import { describe, expect, test } from "bun:test";

import type { FileChange, WriteHook } from "../../src/index.ts";
import { codes, harness, note, text } from "../helpers.ts";

describe("after-write hooks (section 5.10)", () => {
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

  test("a failing hook is a warning and the status stays ok", async () => {
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
    expect(result.notes.map((entry) => [entry.code, entry.severity, entry.data])).toEqual([
      ["hook-failed", "warning", { hook: "lint" }],
      ["hook-failed", "warning", { hook: "garbage" }],
    ]);
    expect(note(result, "hook-failed")?.message).toBe(
      "The lint hook failed after /a.txt was written. The file is changed.",
    );
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
    // The next write needs no read: the record matches the rewritten file.
    expect((await write({ path: "/a.txt", content: "again" })).status).toBe("ok");
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
