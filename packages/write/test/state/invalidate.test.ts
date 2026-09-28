import { describe, expect, spyOn, test } from "bun:test";

import { createInvalidator } from "../../src/index.ts";
import { errorCode, harness } from "../helpers.ts";

describe("createInvalidator", () => {
  test("the next write needs a read again", async () => {
    const { fs, state, read, write } = harness({ files: { "/a.txt": "one\n" } });
    const invalidate = createInvalidator({ fs, state });
    await read({ path: "/a.txt" });
    expect((await write({ path: "/a.txt", content: "two\n" })).status).toBe("ok");
    await invalidate("/a.txt");
    expect(await state.get("/a.txt")).toBeNull();
    expect(errorCode(await write({ path: "/a.txt", content: "three\n" }))).toBe("NOT_READ");
  });

  test("deletes under the stat's resolved path, also for a missing file", async () => {
    const { fs, state } = harness();
    const deleted = spyOn(state, "delete");
    await createInvalidator({ fs, state })("gone/../b.txt");
    expect(deleted).toHaveBeenCalledWith("/b.txt");
  });

  test("a stat failure deletes nothing and does not throw", async () => {
    const { fs, state } = harness({ fsOptions: { denyRoots: ["/secret"] } });
    const deleted = spyOn(state, "delete");
    await createInvalidator({ fs, state })("/secret/x");
    expect(deleted).not.toHaveBeenCalled();
    spyOn(fs, "stat").mockImplementation(async () => {
      throw new Error("down");
    });
    await expect(createInvalidator({ fs, state })("/a")).resolves.toBeUndefined();
  });

  test("rejects bad deps", () => {
    const { fs, state } = harness();
    expect(() => createInvalidator({ fs: {} as never, state })).toThrow(TypeError);
    expect(() => createInvalidator({ fs, state: {} as never })).toThrow(TypeError);
  });
});
