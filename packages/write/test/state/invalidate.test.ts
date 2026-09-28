import { describe, expect, spyOn, test } from "bun:test";

import { createInvalidator } from "../../src/index.ts";
import { errorCode, harness } from "../helpers.ts";

describe("createInvalidator", () => {
  test("the next write needs a read again", async () => {
    const { fs, state, read, write } = harness({ files: { "/a.txt": "one\n" } });
    const invalidate = createInvalidator({ fs, state });
    await read({ path: "/a.txt" });
    expect((await write({ path: "/a.txt", content: "two\n" })).status).toBe("ok");
    expect(await invalidate("/a.txt")).toEqual({
      ok: true,
      resolvedPath: "/a.txt",
      recorded: true,
    });
    expect(await state.get("/a.txt")).toBeNull();
    expect(errorCode(await write({ path: "/a.txt", content: "three\n" }))).toBe("NOT_READ");
  });

  test("deletes under the stat's resolved path, also for a missing file", async () => {
    const { fs, state } = harness();
    const deleted = spyOn(state, "delete");
    expect(await createInvalidator({ fs, state })("gone/../b.txt")).toEqual({
      ok: true,
      resolvedPath: "/b.txt",
      recorded: false,
    });
    expect(deleted).toHaveBeenCalledWith("/b.txt");
  });

  test("a stat failure deletes nothing and is reported", async () => {
    const { fs, state } = harness({ fsOptions: { denyRoots: ["/secret"] } });
    const deleted = spyOn(state, "delete");
    expect(await createInvalidator({ fs, state })("/secret/x")).toEqual({
      ok: false,
      phase: "stat",
      error: { reason: "dangerous-path", detail: "/secret" },
    });
    expect(deleted).not.toHaveBeenCalled();
    spyOn(fs, "stat").mockImplementation(async () => {
      throw new Error("down");
    });
    expect(await createInvalidator({ fs, state })("/a")).toEqual({
      ok: false,
      phase: "stat",
      error: { reason: "io", detail: "down" },
    });
  });

  test("a store failure is reported, not swallowed", async () => {
    const { fs, state, read } = harness({ files: { "/a.txt": "one\n" } });
    await read({ path: "/a.txt" });
    spyOn(state, "delete").mockImplementation(async () => {
      throw new Error("store down");
    });
    expect(await createInvalidator({ fs, state })("/a.txt")).toEqual({
      ok: false,
      phase: "state",
      detail: "store down",
    });
    expect(await state.get("/a.txt")).not.toBeNull();
  });

  test("rejects bad deps", () => {
    const { fs, state } = harness();
    expect(() => createInvalidator({ fs: {} as never, state })).toThrow(TypeError);
    expect(() => createInvalidator({ fs, state: {} as never })).toThrow(TypeError);
  });
});
