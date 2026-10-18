import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, textOf } from "../../src/index.ts";
import type { ReadContext, ReadRecord, ReadStateStore } from "../../src/index.ts";
import { memoryStore } from "../../src/state/index.ts";
import { expectFailure, expectOk, harness, testDigest } from "../helpers.ts";

interface Host {
  readonly session: string;
  readonly secret: string;
}

const SENTINEL = "host-sentinel-5c21";

function spyStore(): ReadStateStore & { puts: [string, ReadRecord][] } {
  const puts: [string, ReadRecord][] = [];
  return {
    puts,
    get: async () => null,
    put: async (key, record) => {
      puts.push([key, record]);
    },
    delete: async () => {},
  };
}

describe("record", () => {
  test("a whole-file read records an observation in the store", async () => {
    const state = memoryStore();
    const { read } = harness({ files: { "/a.txt": "one\ntwo\n" }, deps: { state } });
    const result = expectOk(await read({ path: "/a.txt" }));

    const record = await state.get("/a.txt");
    expect(record?.observationId).toBe(result.observation?.id as string);
    expect(record?.wholeFileVisible).toBe(true);
    expect(record?.totalsExact).toBe(true);
    expect(record?.request).toEqual({ offset: 1, limit: 2_000 });
  });

  test("a store failure never fails the read", async () => {
    const failing: ReadStateStore = {
      async get() {
        throw new Error("store down");
      },
      async put() {
        throw new Error("store down");
      },
      async delete() {
        throw new Error("store down");
      },
    };
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { state: failing } });
    expect((await read({ path: "/a.txt" })).status).toBe("ok");
  });

  test("a store that throws synchronously never fails the read", async () => {
    const failing = {
      get: () => null,
      put: () => {
        throw new Error("store down");
      },
      delete: () => undefined,
    } as unknown as ReadStateStore;
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { state: failing } });
    expect(textOf(expectOk(await read({ path: "/a.txt" })))).toBe("1|one");
  });

  test("the record is schema 2 and copies the observation, file, digest, totals, and request", async () => {
    const state = spyStore();
    const { read } = harness({ files: { "/a.txt": "one\ntwo\nthree\n" }, deps: { state } });
    const result = expectOk(await read({ path: "/a.txt", offset: 2, limit: 1 }));
    const observation = result.observation;
    if (observation === null) throw new Error("expected an observation");
    expect(state.puts).toEqual([
      [
        "/a.txt",
        {
          schema: 2,
          origin: "read",
          observationId: observation.id,
          resolvedPath: "/a.txt",
          identity: result.file.identity,
          version: "memory:/a.txt:1",
          digest: "test-fnv",
          contentId: observation.contentId,
          viewId: observation.viewId,
          observedAt: "2026-08-22T00:00:00.000Z",
          wholeFileVisible: false,
          seenLines: [{ start: 2, end: 2 }],
          totalsExact: true,
          request: { offset: 2, limit: 1 },
        },
      ],
    ]);
  });

  test("nothing is recorded on a refusal", async () => {
    const state = spyStore();
    const { read } = harness({
      files: { "/b.bin": new Uint8Array([0, 1, 2]) },
      deps: { state },
    });
    expectFailure(await read({ path: "/missing.txt" }), "NOT_FOUND");
    expect((await read({ path: "/b.bin" })).status).toBe("unsupported");
    expect(state.puts).toEqual([]);
  });
});

describe("ranged reads", () => {
  const LINES = Array.from({ length: 35 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";

  test("ranges that together show every line make the record whole", async () => {
    const state = memoryStore();
    const { read } = harness({ files: { "/a.txt": LINES }, deps: { state } });
    expectOk(await read({ path: "/a.txt", offset: 1, limit: 30 }));
    expect((await state.get("/a.txt"))?.wholeFileVisible).toBe(false);
    expectOk(await read({ path: "/a.txt", offset: 28, limit: 20 }));
    const record = await state.get("/a.txt");
    expect(record?.wholeFileVisible).toBe(true);
    expect(record?.seenLines).toEqual([{ start: 1, end: 35 }]);
  });

  test("ranges with a gap keep the record partial", async () => {
    const state = memoryStore();
    const { read } = harness({ files: { "/a.txt": LINES }, deps: { state } });
    await read({ path: "/a.txt", offset: 1, limit: 10 });
    await read({ path: "/a.txt", offset: 12, limit: 30 });
    const record = await state.get("/a.txt");
    expect(record?.wholeFileVisible).toBe(false);
    expect(record?.seenLines).toEqual([
      { start: 1, end: 10 },
      { start: 12, end: 35 },
    ]);
  });

  test("parallel ranged reads all join the record", async () => {
    const state = memoryStore();
    const { read } = harness({ files: { "/a.txt": LINES }, deps: { state } });
    await Promise.all([
      read({ path: "/a.txt", offset: 1, limit: 10 }),
      read({ path: "/a.txt", offset: 11, limit: 10 }),
      read({ path: "/a.txt", offset: 21, limit: 15 }),
    ]);
    expect((await state.get("/a.txt"))?.wholeFileVisible).toBe(true);
  });

  test("a change to the file drops the ranges of the old content", async () => {
    const state = memoryStore();
    const { read, fs } = harness({ files: { "/a.txt": LINES }, deps: { state } });
    await read({ path: "/a.txt", offset: 1, limit: 30 });
    fs.setFile("/a.txt", LINES.replace("line 2\n", "line two\n"));
    await read({ path: "/a.txt", offset: 28, limit: 20 });
    const record = await state.get("/a.txt");
    expect(record?.wholeFileVisible).toBe(false);
    expect(record?.seenLines).toEqual([{ start: 28, end: 35 }]);
  });

  test("a ranged read after a whole read of the same content keeps the record whole", async () => {
    const state = memoryStore();
    const { read } = harness({ files: { "/a.txt": LINES }, deps: { state } });
    await read({ path: "/a.txt" });
    await read({ path: "/a.txt", offset: 5, limit: 2 });
    const record = await state.get("/a.txt");
    expect(record?.wholeFileVisible).toBe(true);
    expect(record?.request).toEqual({ offset: 5, limit: 2 });
  });

  test("a range with a clamped line does not count", async () => {
    const state = memoryStore();
    const long = `short\n${"x".repeat(50)}\nend\n`;
    const { read } = harness({
      files: { "/a.txt": long },
      limits: { maxCharsPerLine: 10 },
      deps: { state },
    });
    const result = expectOk(await read({ path: "/a.txt", offset: 2, limit: 2 }));
    expect(result.observation?.visibleLines).toBeNull();
    await read({ path: "/a.txt", offset: 1, limit: 1 });
    await read({ path: "/a.txt", offset: 3, limit: 1 });
    const record = await state.get("/a.txt");
    expect(record?.wholeFileVisible).toBe(false);
    expect(record?.seenLines).toEqual([
      { start: 1, end: 1 },
      { start: 3, end: 3 },
    ]);
  });
});

describe("state(call)", () => {
  function hostTool(state: (call: ReadContext<Host>) => ReadStateStore | null) {
    const fs = memoryFileSystem({
      files: { "/a.txt": "one\ntwo\n", "/b.bin": new Uint8Array([0, 1]) },
    });
    return createReadTool<Host>({ fs, digest: testDigest(), state });
  }

  test("runs at most once for each read, with the caller's call object", async () => {
    const calls: ReadContext<Host>[] = [];
    const store = memoryStore();
    const read = hostTool((call) => {
      calls.push(call);
      return store;
    });
    const first: ReadContext<Host> = { host: { session: "s1", secret: SENTINEL } };
    const second: ReadContext<Host> = { host: { session: "s2", secret: SENTINEL }, callId: "c2" };
    expectOk(await read({ path: "/a.txt" }, first));
    expectOk(await read({ path: "/a.txt", offset: 2 }, second));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(first);
    expect(calls[1]).toBe(second);
  });

  test("does not run when the read has nothing to record", async () => {
    let built = 0;
    const read = hostTool(() => {
      built += 1;
      return memoryStore();
    });
    const call: ReadContext<Host> = { host: { session: "s1", secret: SENTINEL } };
    expectFailure(await read({ path: "/missing.txt" }, call), "NOT_FOUND");
    expect((await read({ path: "/b.bin" }, call)).status).toBe("unsupported");
    expect((await read({ path: "" }, call)).status).toBe("error");
    expect(built).toBe(0);

    expect(() =>
      createReadTool<Host>({
        fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
        state: () => {
          built += 1;
          return memoryStore();
        },
        digest: null,
      } as never),
    ).toThrow("state needs a digest");
    expect(built).toBe(0);
  });

  test("state: null never builds or touches a store", async () => {
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { state: null } });
    expectOk(await read({ path: "/a.txt" }));
  });

  test("a factory that returns null skips the record", async () => {
    let built = 0;
    const read = hostTool(() => {
      built += 1;
      return null;
    });
    const result = expectOk(
      await read({ path: "/a.txt" }, { host: { session: "s1", secret: SENTINEL } }),
    );
    expect(textOf(result)).toBe("1|one\n2|two");
    expect(built).toBe(1);
  });

  test("a factory that throws gives EXTENSION_FAILED", async () => {
    const read = hostTool(() => {
      throw new Error("no session");
    });
    const result = expectFailure(
      await read({ path: "/a.txt" }, { host: { session: "s1", secret: SENTINEL } }),
      "EXTENSION_FAILED",
    );
    expect(result.notes[0]?.data).toEqual({ extension: "state", phase: "verification" });
    expect(textOf(result)).not.toContain("no session");
  });

  test("a factory that returns something else gives EXTENSION_FAILED", async () => {
    const read = hostTool(() => ({}) as ReadStateStore);
    const result = expectFailure(
      await read({ path: "/a.txt" }, { host: { session: "s1", secret: SENTINEL } }),
      "EXTENSION_FAILED",
    );
    expect(result.notes[0]?.data).toEqual({ extension: "state", phase: "verification" });
  });

  test("host is absent from the stored record", async () => {
    const store = spyStore();
    const host: Host = { session: "s1", secret: SENTINEL };
    const read = hostTool(() => store);
    expectOk(await read({ path: "/a.txt" }, { host, callId: "call-1" }));
    expect(store.puts).toHaveLength(1);
    const [key, record] = store.puts[0] ?? [];
    expect(key).toBe("/a.txt");
    expect(JSON.stringify(record)).not.toContain(SENTINEL);
    expect(JSON.stringify(record)).not.toContain("call-1");
    expect(Object.values(record ?? {})).not.toContain(host);
  });
});

describe("state dependency", () => {
  test("a malformed state throws TypeError when the tool is built", () => {
    const fs = memoryFileSystem({ files: {} });
    const digest = testDigest();
    expect(() => createReadTool({ fs, digest, state: {} as ReadStateStore })).toThrow(
      "state must be a store, a function that returns one, or null",
    );
    expect(() =>
      createReadTool({ fs, digest, state: "memory" as unknown as ReadStateStore }),
    ).toThrow(TypeError);
  });

  test("a state with digest null throws TypeError, as in the write tools", () => {
    const fs = memoryFileSystem({ files: {} });
    const state = memoryStore();
    expect(() => createReadTool({ fs, state, digest: null } as never)).toThrow(
      "state needs a digest: records name the digest that made them",
    );
    expect(() => createReadTool({ fs, state })).not.toThrow();
    expect(() => createReadTool({ fs, state: null })).not.toThrow();
    expect(() => createReadTool({ fs, digest: testDigest() })).not.toThrow();
  });
});
