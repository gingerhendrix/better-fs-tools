import { describe, expect, test } from "bun:test";

import type { ReadRecord } from "../../src/index.ts";
import { createMemoryStore } from "../../src/state/index.ts";

function record(overrides: Partial<ReadRecord> = {}): ReadRecord {
  return {
    schema: 1,
    observationId: "obs-1",
    resolvedPath: "/a.txt",
    identity: "1:2:3:4:5",
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
    const store = createMemoryStore();
    await store.put("/a.txt", record());
    expect((await store.get("/a.txt"))?.observationId).toBe("obs-1");
    expect(await store.get("/b.txt")).toBeNull();
  });

  test("delete removes an entry", async () => {
    const store = createMemoryStore();
    await store.put("/a.txt", record());
    await store.delete("/a.txt");
    expect(await store.get("/a.txt")).toBeNull();
  });

  test("entries expire on the supplied clock", async () => {
    let now = 1_000;
    const store = createMemoryStore({ ttlMs: 50, clock: () => now });
    await store.put("/a.txt", record());
    now = 1_040;
    expect(await store.get("/a.txt")).not.toBeNull();
    now = 1_060;
    expect(await store.get("/a.txt")).toBeNull();
  });

  test("the entry cap evicts the least recently used key", async () => {
    const store = createMemoryStore({ maxEntries: 2 });
    await store.put("/a.txt", record({ resolvedPath: "/a.txt" }));
    await store.put("/b.txt", record({ resolvedPath: "/b.txt" }));
    await store.get("/a.txt");
    await store.put("/c.txt", record({ resolvedPath: "/c.txt" }));

    expect(await store.get("/b.txt")).toBeNull();
    expect(await store.get("/a.txt")).not.toBeNull();
    expect(await store.get("/c.txt")).not.toBeNull();
  });

  test("options and keys are validated", async () => {
    expect(() => createMemoryStore({ maxEntries: 0 })).toThrow(TypeError);
    expect(() => createMemoryStore({ ttlMs: -1 })).toThrow(TypeError);
    const store = createMemoryStore();
    await expect(store.get("")).rejects.toThrow(TypeError);
  });

  test("two stores are two scopes", async () => {
    const first = createMemoryStore();
    const second = createMemoryStore();
    await first.put("/a.txt", record());
    expect(await second.get("/a.txt")).toBeNull();
  });
});
