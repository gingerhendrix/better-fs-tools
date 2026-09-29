import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, memoryStore } from "../../src/index.ts";
import type { Clock, ReadRecord } from "../../src/index.ts";

function record(overrides: Partial<ReadRecord> = {}): ReadRecord {
  return {
    schema: 2,
    origin: "read",
    observationId: "obs-1",
    resolvedPath: "/a.txt",
    identity: "1:2:3:4:5",
    version: "1:2:3:4:5",
    digest: "sha256",
    contentId: "sha256:abc",
    viewId: "sha256:def",
    observedAt: "2026-08-22T00:00:00.000Z",
    wholeFileVisible: true,
    totalsExact: true,
    request: { offset: 1, limit: 2_000 },
    ...overrides,
  };
}

describe("memory store", () => {
  test("stores and returns a record by key", async () => {
    const store = memoryStore();
    await store.put("/a.txt", record());
    expect((await store.get("/a.txt"))?.observationId).toBe("obs-1");
    expect(await store.get("/b.txt")).toBeNull();
  });

  test("delete removes an entry", async () => {
    const store = memoryStore();
    await store.put("/a.txt", record());
    await store.delete("/a.txt");
    expect(await store.get("/a.txt")).toBeNull();
  });

  test("entries expire on the supplied clock", async () => {
    let now = 1_000;
    const store = memoryStore({ ttlMs: 50, clock: () => new Date(now) });
    await store.put("/a.txt", record());
    now = 1_040;
    expect(await store.get("/a.txt")).not.toBeNull();
    now = 1_060;
    expect(await store.get("/a.txt")).toBeNull();
  });

  test("the store and the tools take the same clock", async () => {
    const clock: Clock = () => new Date(0);
    const state = memoryStore({ clock });
    const digest = { id: "d", create: () => ({ update() {}, digest: () => "x" }), hash: () => "x" };
    const read = createReadTool({
      fs: memoryFileSystem({ files: { "/a.txt": "a\n" } }),
      state,
      digest,
      clock,
    });
    await read({ path: "/a.txt" });
    expect((await state.get("/a.txt"))?.observedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  test("a clock that returns no valid Date is refused when the store is used", async () => {
    const store = memoryStore({ clock: (() => 5) as never });
    await expect(store.get("/a.txt")).rejects.toThrow("clock must return a valid Date");
    const invalid = memoryStore({ clock: () => new Date(Number.NaN) });
    await expect(invalid.get("/a.txt")).rejects.toThrow("clock must return a valid Date");
  });

  test("the entry cap evicts the least recently used key", async () => {
    const store = memoryStore({ maxEntries: 2 });
    await store.put("/a.txt", record({ resolvedPath: "/a.txt" }));
    await store.put("/b.txt", record({ resolvedPath: "/b.txt" }));
    await store.get("/a.txt");
    await store.put("/c.txt", record({ resolvedPath: "/c.txt" }));

    expect(await store.get("/b.txt")).toBeNull();
    expect(await store.get("/a.txt")).not.toBeNull();
    expect(await store.get("/c.txt")).not.toBeNull();
  });

  test("options and keys are validated", async () => {
    expect(() => memoryStore({ maxEntries: 0 })).toThrow(TypeError);
    expect(() => memoryStore({ ttlMs: -1 })).toThrow(TypeError);
    const store = memoryStore();
    await expect(store.get("")).rejects.toThrow(TypeError);
  });

  test("two stores are two scopes", async () => {
    const first = memoryStore();
    const second = memoryStore();
    await first.put("/a.txt", record());
    expect(await second.get("/a.txt")).toBeNull();
  });
});
