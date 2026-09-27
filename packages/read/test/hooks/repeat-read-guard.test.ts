import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, repeatReadGuard, textOf } from "../../src/index.ts";
import type { ReadRecord } from "../../src/index.ts";
import { createMemoryStore } from "../../src/state/index.ts";
import { expectOk, harness, lineText, note, testDigest } from "../helpers.ts";

const FILE = "one\ntwo\nthree\n";

function guarded(options: Parameters<typeof repeatReadGuard>[0] = {}, state = createMemoryStore()) {
  return harness({
    files: { "/a.txt": FILE },
    deps: { hooks: [repeatReadGuard(options)], state },
  });
}

describe("repeatReadGuard", () => {
  test("fires on the second identical read", async () => {
    const { read } = guarded();
    const first = expectOk(await read({ path: "/a.txt" }));
    expect(lineText(first)).toEqual(["one", "two", "three"]);
    expect(note(first, "repeat-read")).toBeUndefined();

    const second = expectOk(await read({ path: "/a.txt" }));
    expect(second.view.lines).toEqual([]);
    expect(second.view).toMatchObject({ startLine: 1, endLine: 0, bytes: 0, partial: true });
    expect(second.totals).toEqual(first.totals);
    expect(second.continuation).toEqual(first.continuation);
    expect(note(second, "repeat-read")).toMatchObject({
      severity: "info",
      data: {
        observationId: first.observation?.id as string,
        observedAt: "2026-08-22T00:00:00.000Z",
      },
    });
    expect(note(second, "repeat-read")?.message).toContain("/a.txt has not changed");
    expect(note(second, "view-modified")?.data).toEqual({ hook: "repeat-read-guard" });
    expect(second.observation?.wholeFileVisible).toBe(false);
    expect(second.observation?.contentId).toBe(first.observation?.contentId as string);
    expect(textOf(second)).not.toContain("1|one");
  });

  test("does not fire after an edit", async () => {
    const { read, fs } = guarded();
    expectOk(await read({ path: "/a.txt" }));
    fs.write("/a.txt", "one\ntwo\nfour\n");
    const after = expectOk(await read({ path: "/a.txt" }));
    expect(lineText(after)).toEqual(["one", "two", "four"]);
    expect(note(after, "repeat-read")).toBeUndefined();
  });

  test("ignores a record a write tool stored, even with the same content", async () => {
    const state = createMemoryStore();
    const { read } = guarded({}, state);
    const first = expectOk(await read({ path: "/a.txt" }));
    const stored = await state.get("/a.txt");
    if (stored === null) throw new Error("expected a record");
    const written: ReadRecord = { ...stored, origin: "write", request: null };
    await state.put("/a.txt", written);
    const after = expectOk(await read({ path: "/a.txt" }));
    expect(after.observation?.contentId).toBe(first.observation?.contentId as string);
    expect(lineText(after)).toEqual(["one", "two", "three"]);
    expect(note(after, "repeat-read")).toBeUndefined();
  });

  test("does not fire for another offset or limit", async () => {
    const { read } = guarded();
    expectOk(await read({ path: "/a.txt", offset: 1, limit: 2 }));
    expect(lineText(expectOk(await read({ path: "/a.txt", offset: 2, limit: 2 })))).toEqual([
      "two",
      "three",
    ]);
    expect(lineText(expectOk(await read({ path: "/a.txt", offset: 2, limit: 1 })))).toEqual([
      "two",
    ]);
    expect(lineText(expectOk(await read({ path: "/a.txt", offset: 2, limit: 1 })))).toEqual([]);
  });

  test("does nothing without a digest or without state", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": FILE } });
    const noDigest = createReadTool({
      fs,
      hooks: [repeatReadGuard()],
      state: createMemoryStore(),
    });
    const noState = createReadTool({ fs, digest: testDigest(), hooks: [repeatReadGuard()] });
    for (const read of [noDigest, noState]) {
      expectOk(await read({ path: "/a.txt" }));
      const again = expectOk(await read({ path: "/a.txt" }));
      expect(lineText(again)).toEqual(["one", "two", "three"]);
      expect(again.notes).toEqual([]);
    }
  });

  test("does not fire when the scan stopped before EOF (no contentId)", async () => {
    const { read } = harness({
      files: { "/a.txt": FILE },
      limits: { maxScanBytes: 5 },
      deps: { hooks: [repeatReadGuard()], state: createMemoryStore() },
    });
    expectOk(await read({ path: "/a.txt" }));
    const again = expectOk(await read({ path: "/a.txt" }));
    expect(again.observation?.contentId).toBeNull();
    expect(lineText(again)).toEqual(["one"]);
  });

  test("takes a custom message", async () => {
    const { read } = guarded({ message: (previous) => `seen ${previous.request?.limit}` });
    await read({ path: "/a.txt" });
    expect(note(await read({ path: "/a.txt" }), "repeat-read")?.message).toBe("seen 2000");
  });

  test("a non-function message throws TypeError", () => {
    expect(() => repeatReadGuard({ message: "seen" } as never)).toThrow(TypeError);
  });
});
