import { describe, expect, test } from "bun:test";

import { createReadTool, textOf } from "../../src/index.ts";
import { ByteCursor } from "../../src/core/cursor.ts";
import { expectFailure, harness } from "../helpers.ts";

describe("ByteCursor", () => {
  test("splits large chunks and honours pushback", async () => {
    const source = (async function* iterate() {
      yield new Uint8Array(100_000).fill(1);
    })();
    const cursor = new ByteCursor(source);

    const first = await cursor.next(undefined);
    if (first.done) throw new Error("expected a chunk");
    expect(first.value.byteLength).toBe(64 * 1024);
    cursor.unshift(first.value.subarray(0, 10));
    const pushed = await cursor.next(undefined);
    expect(pushed.done).toBe(false);
    if (!pushed.done) expect(pushed.value.byteLength).toBe(10);
    await cursor.close();
  });

  test("skips empty chunks and rejects malformed adapter output", async () => {
    const empty = (async function* iterate() {
      yield new Uint8Array(0);
      yield new Uint8Array([1, 2]);
    })();
    const cursor = new ByteCursor(empty);
    const item = await cursor.next(undefined);
    if (item.done) throw new Error("expected a chunk");
    expect(item.value.byteLength).toBe(2);

    const bad = {
      [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: "text" }) }),
    };
    const badCursor = new ByteCursor(bad as never);
    await expect(badCursor.next(undefined)).rejects.toThrow(TypeError);
  });

  test("a malformed byte source becomes an IO_ERROR result", async () => {
    const { fs } = harness({ files: { "/a.txt": "one\n" } });
    const broken = {
      ...fs,
      async open(path: string, options: Parameters<typeof fs.open>[1]) {
        const opened = await fs.open(path, options);
        if (!opened.ok) return opened;
        return {
          ok: true as const,
          file: {
            ...opened.file,
            bytes: () => ({
              [Symbol.asyncIterator]: () => ({ next: async () => ({ done: false, value: 42 }) }),
            }),
          },
        };
      },
    };
    const result = await createReadTool({ fs: broken as never })({ path: "/a.txt" });
    expectFailure(result, "IO_ERROR");
    expect(textOf(result)).toContain("[read:io-error]");
  });
});
