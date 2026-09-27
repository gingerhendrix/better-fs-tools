import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, directoryListing, textOf } from "../../src/index.ts";
import type {
  AfterReadContext,
  FileConverter,
  ReadContext,
  ReadHook,
  ReadOk,
  ReadOutcome,
  ReadRecord,
  ReadStateStore,
} from "../../src/index.ts";
import { createMemoryStore } from "../../src/state/index.ts";
import {
  FIXED_DATE,
  expectFailure,
  expectMedia,
  expectOk,
  expectUnsupported,
  harness,
  note,
  testDigest,
} from "../helpers.ts";

interface Host {
  readonly id: string;
}

type Edit = (outcome: ReadOutcome, ctx: AfterReadContext<unknown>) => unknown;

function hook(id: string, edit: Edit): ReadHook<unknown> {
  return { id, afterRead: (outcome, ctx) => edit(outcome, ctx) as ReadOutcome };
}

/** Records every outcome and context it sees, and returns the outcome unchanged. */
function spyHook(id = "spy") {
  const seen: { outcome: ReadOutcome; ctx: AfterReadContext<unknown> }[] = [];
  return {
    seen,
    hook: hook(id, (outcome, ctx) => {
      seen.push({ outcome, ctx });
      return outcome;
    }),
  };
}

function upper(outcome: ReadOutcome): ReadOutcome {
  if (outcome.status !== "ok") return outcome;
  const lines = outcome.view.lines.map((line) => ({ ...line, text: line.text.toUpperCase() }));
  return { ...outcome, view: { ...outcome.view, lines } };
}

const mediaConverter: FileConverter<unknown> = {
  id: "media",
  target: "file",
  accepts: () => true,
  convert: async () => ({
    kind: "media",
    parts: [{ type: "media", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) }],
  }),
};

describe("hooks", () => {
  test("run in order, each on the previous hook's outcome", async () => {
    const order: string[] = [];
    const first = hook("first", (outcome) => {
      order.push("first");
      return upper(outcome);
    });
    const { seen, hook: second } = spyHook("second");
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [first, second] } });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(order).toEqual(["first"]);
    const seenOutcome = seen[0]?.outcome as ReadOk;
    expect(seenOutcome.view.lines.map((line) => line.text)).toEqual(["ONE"]);
    expect(textOf(result)).toContain("1|ONE");
  });

  test("get the same call object the caller passed", async () => {
    const seen: ReadContext<Host>[] = [];
    const read = createReadTool<Host>({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      hooks: [
        {
          id: "call",
          afterRead(outcome, ctx) {
            seen.push(ctx.call);
            expect(ctx.call.host.id).toBe("h1");
            return outcome;
          },
        },
      ],
    });
    const call: ReadContext<Host> = { host: { id: "h1" }, callId: "c1" };
    await read({ path: "/a.txt" }, call);
    await read({ path: "/missing.txt" }, call);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(call);
    expect(seen[1]).toBe(call);
  });

  test("the context has the tool, request, limits, messages, digest, and clock", async () => {
    const { seen, hook: spy } = spyHook();
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [spy] } });
    await read({ path: "/a.txt", offset: 1 });
    const ctx = seen[0]?.ctx;
    expect(ctx?.tool).toBe("read");
    expect(ctx?.request).toEqual({ path: "/a.txt", offset: 1, limit: 2_000, ranged: true });
    expect(ctx?.limits.maxLines).toBe(2_000);
    expect(ctx?.digest?.id).toBe("test-fnv");
    expect(ctx?.clock()).toBe(FIXED_DATE);
    expect(ctx?.previous).toBeNull();
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  test("run for every outcome status", async () => {
    const { seen, hook: spy } = spyHook();
    const { read } = harness({
      files: { "/a.txt": "one\n", "/b.bin": new Uint8Array([0, 1, 2, 0]), "/d/x.txt": "x" },
      deps: { hooks: [spy], converters: [directoryListing()] },
    });
    expectOk(await read({ path: "/a.txt" }));
    expectUnsupported(await read({ path: "/b.bin" }), "BINARY");
    expectFailure(await read({ path: "/missing.txt" }), "NOT_FOUND");
    expectOk(await read({ path: "/d" }));
    expect(seen.map(({ outcome }) => outcome.status)).toEqual(["ok", "unsupported", "error", "ok"]);

    const media = harness({
      files: { "/a.txt": "one\n" },
      deps: { hooks: [spy], converters: [mediaConverter] },
    });
    expectMedia(await media.read({ path: "/a.txt" }));
    expect(seen.at(-1)?.outcome.status).toBe("media");
  });

  test("do not run for invalid input or after an abort", async () => {
    const { seen, hook: spy } = spyHook();
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [spy] } });
    expectFailure(await read({ path: "" }), "INVALID_INPUT");
    const controller = new AbortController();
    controller.abort();
    expectFailure(await read({ path: "/a.txt" }, { signal: controller.signal }), "ABORTED");
    expect(seen).toHaveLength(0);
  });

  test("a hook may change notes without marking the view", async () => {
    const extra = { code: "hello", severity: "info" as const, message: "hi" };
    const { read } = harness({
      files: { "/a.txt": "one\n" },
      deps: {
        hooks: [hook("notes", (outcome) => ({ ...outcome, notes: [...outcome.notes, extra] }))],
      },
    });
    const plain = expectOk(
      await harness({ files: { "/a.txt": "one\n" } }).read({ path: "/a.txt" }),
    );
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.notes).toEqual([extra]);
    expect(result.observation).toEqual(plain.observation);
  });

  test("a hook may refuse an ok read", async () => {
    const state = createMemoryStore();
    const refuse = hook("refuse", (outcome) => ({
      status: "error",
      code: "DENIED",
      request: outcome.request,
      file: outcome.file,
      notes: [{ code: "denied", severity: "warning", message: "no" }],
    }));
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [refuse], state } });
    expectFailure(await read({ path: "/a.txt" }), "DENIED");
    expect(await state.get("/a.txt")).toBeNull();
  });
});

describe("hook rules", () => {
  const extensionData = (id: string) => ({ extension: "hooks", phase: "hooks", id });

  test("a hook cannot turn an error into ok, or unsupported into ok", async () => {
    const ok = expectOk(await harness({ files: { "/a.txt": "one\n" } }).read({ path: "/a.txt" }));
    const { content: _content, ...okOutcome } = ok;
    const revive = hook("revive", (outcome) =>
      outcome.status === "ok" ? outcome : { ...okOutcome, request: outcome.request },
    );
    const { read } = harness({
      files: { "/a.txt": "one\n", "/b.bin": new Uint8Array([0, 1, 2, 0]) },
      deps: { hooks: [revive] },
    });
    const missing = expectFailure(await read({ path: "/missing.txt" }), "EXTENSION_FAILED");
    expect(missing.notes[0]?.data).toEqual(extensionData("revive"));
    const binary = expectFailure(await read({ path: "/b.bin" }), "EXTENSION_FAILED");
    expect(binary.notes[0]?.data).toEqual(extensionData("revive"));
  });

  test("a hook that changes totals gives EXTENSION_FAILED", async () => {
    const state = createMemoryStore();
    const lie = hook("lie", (outcome) =>
      outcome.status === "ok" ? { ...outcome, totals: { ...outcome.totals, lines: 99 } } : outcome,
    );
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [lie], state } });
    const result = expectFailure(await read({ path: "/a.txt" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual(extensionData("lie"));
    expect(await state.get("/a.txt")).toBeNull();
  });

  test("every frozen field must keep its value", async () => {
    const changes: Record<string, (outcome: ReadOk) => ReadOk> = {
      request: (o) => ({ ...o, request: { ...o.request, limit: 1 } }),
      file: (o) => ({ ...o, file: { ...o.file, displayPath: "/other.txt" } }),
      classification: (o) => ({ ...o, classification: { ...o.classification, confidence: "low" } }),
      conversion: (o) => ({ ...o, conversion: { converter: "fake", mimeType: null } }),
      truncation: (o) => ({
        ...o,
        truncation: { truncated: true, reasons: ["lines"], primary: "lines" },
      }),
      continuation: (o) => ({ ...o, continuation: { available: true, next: { path: "/a.txt" } } }),
      totals: (o) => ({ ...o, totals: { ...o.totals, exact: false } }),
      observation: (o) => ({ ...o, observation: null }),
      "missing totals": ({ totals: _totals, ...rest }) => rest as ReadOk,
    };
    for (const [name, change] of Object.entries(changes)) {
      const edit = hook(name, (outcome) => (outcome.status === "ok" ? change(outcome) : outcome));
      const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [edit] } });
      const result = expectFailure(await read({ path: "/a.txt" }), "EXTENSION_FAILED");
      expect(result.notes[0]?.data).toEqual(extensionData(name));
    }
  });

  test("a copy with equal values keeps the rules", async () => {
    const copy = hook("copy", (outcome) => structuredClone(outcome));
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [copy] } });
    expect(textOf(expectOk(await read({ path: "/a.txt" })))).toBe("1|one");
  });

  test("a throwing or malformed hook gives EXTENSION_FAILED, and later hooks do not run", async () => {
    const { seen, hook: after } = spyHook("after");
    const cases: [string, Edit][] = [
      [
        "throws",
        () => {
          throw new Error("hook bug");
        },
      ],
      ["null", () => null],
      ["bad-status", (outcome) => ({ ...outcome, status: "maybe" })],
      ["bad-notes", (outcome) => ({ ...outcome, notes: [{ code: 1 }] })],
      [
        "bad-view",
        (outcome) =>
          outcome.status === "ok"
            ? { ...outcome, view: { ...outcome.view, lines: [{ text: 1 }] } }
            : outcome,
      ],
      [
        "async-throw",
        async () => {
          throw new Error("later");
        },
      ],
    ];
    for (const [id, edit] of cases) {
      const { read } = harness({
        files: { "/a.txt": "one\n" },
        deps: { hooks: [hook(id, edit), after] },
      });
      const result = expectFailure(await read({ path: "/a.txt" }), "EXTENSION_FAILED");
      expect(result.notes[0]?.data).toEqual(extensionData(id));
    }
    expect(seen).toHaveLength(0);
  });

  test("an abort while a hook waits gives ABORTED in the hooks phase", async () => {
    const controller = new AbortController();
    const state = createMemoryStore();
    const wait = hook("wait", () => {
      controller.abort();
      return new Promise(() => {});
    });
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [wait], state } });
    const result = expectFailure(
      await read({ path: "/a.txt" }, { signal: controller.signal }),
      "ABORTED",
    );
    expect(result.notes[0]?.data).toEqual({ phase: "hooks" });
    expect(await state.get("/a.txt")).toBeNull();
  });
});

describe("view edits", () => {
  const digest = testDigest();

  test("recompute viewId, set wholeFileVisible false, and add a view-modified note", async () => {
    const state = createMemoryStore();
    const shout = hook("shout", upper);
    const { read } = harness({
      files: { "/a.txt": "one\ntwo\n" },
      deps: { hooks: [shout], state },
    });
    const plain = expectOk(
      await harness({ files: { "/a.txt": "one\ntwo\n" } }).read({ path: "/a.txt" }),
    );
    const result = expectOk(await read({ path: "/a.txt" }));

    const observation = result.observation;
    if (observation === null || plain.observation === null)
      throw new Error("expected observations");
    expect(observation.viewId).toBe(digest.hash("ONE\nTWO"));
    expect(observation.viewId).not.toBe(plain.observation.viewId);
    expect(observation.id).not.toBe(plain.observation.id);
    expect(observation.contentId).toBe(plain.observation.contentId);
    expect(observation.statId).toBe(plain.observation.statId);
    expect(observation.wholeFileVisible).toBe(false);
    expect(note(result, "view-modified")).toEqual({
      code: "view-modified",
      severity: "info",
      message: "The shout hook changed this view, so it is not the exact file text.",
      data: { hook: "shout" },
    });

    const record = await state.get("/a.txt");
    expect(record?.viewId).toBe(observation.viewId);
    expect(record?.observationId).toBe(observation.id);
    expect(record?.wholeFileVisible).toBe(false);
  });

  test("each hook that edits the view adds its own note", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\n" },
      deps: {
        hooks: [
          hook("shout", upper),
          hook("same", (outcome) => outcome),
          hook("empty", (outcome) =>
            outcome.status === "ok"
              ? { ...outcome, view: { ...outcome.view, lines: [] } }
              : outcome,
          ),
        ],
      },
    });
    const result = expectOk(await read({ path: "/a.txt" }));
    const hooks = result.notes
      .filter((entry) => entry.code === "view-modified")
      .map((entry) => entry.data?.hook);
    expect(hooks).toEqual(["shout", "empty"]);
    expect(result.observation?.viewId).toBe(digest.hash(""));
  });

  test("an edit with no digest adds the note and keeps the observation null", async () => {
    const read = createReadTool({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      hooks: [hook("shout", upper)],
    });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.observation).toBeNull();
    expect(note(result, "view-modified")).toBeDefined();
  });

  test("an edit to media parts recomputes viewId", async () => {
    const swap = hook("swap", (outcome) =>
      outcome.status === "media"
        ? { ...outcome, parts: [{ type: "text", text: "no image here" }] }
        : outcome,
    );
    const { read } = harness({
      files: { "/a.txt": "one\n" },
      deps: { hooks: [swap], converters: [mediaConverter] },
    });
    const plain = expectMedia(
      await harness({ files: { "/a.txt": "one\n" }, deps: { converters: [mediaConverter] } }).read({
        path: "/a.txt",
      }),
    );
    const result = expectMedia(await read({ path: "/a.txt" }));
    expect(result.parts).toEqual([{ type: "text", text: "no image here" }]);
    expect(result.observation?.viewId).not.toBe(plain.observation?.viewId);
    expect(note(result, "view-modified")?.data).toEqual({ hook: "swap" });
  });
});

describe("previous", () => {
  test("is the record from before this read, and record then stores the new one", async () => {
    const state = createMemoryStore();
    const { seen, hook: spy } = spyHook();
    const { read, fs } = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [spy], state } });
    const first = expectOk(await read({ path: "/a.txt" }));
    expect(seen[0]?.ctx.previous).toBeNull();

    fs.write("/a.txt", "two\n");
    const second = expectOk(await read({ path: "/a.txt", offset: 1, limit: 5 }));
    const previous = seen[1]?.ctx.previous;
    expect(previous?.observationId).toBe(first.observation?.id as string);
    expect(previous?.request).toEqual({ offset: 1, limit: 2_000 });
    expect((await state.get("/a.txt"))?.observationId).toBe(second.observation?.id as string);
  });

  test("is null with no state, for a failure with no file, and when get fails", async () => {
    const { seen, hook: spy } = spyHook();
    const failing: ReadStateStore = {
      get: async () => {
        throw new Error("down");
      },
      put: async () => {},
      delete: async () => {},
    };
    const none = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [spy] } });
    await none.read({ path: "/a.txt" });
    const broken = harness({
      files: { "/a.txt": "one\n" },
      deps: { hooks: [spy], state: failing },
    });
    await broken.read({ path: "/a.txt" });
    expect(seen.map(({ ctx }) => ctx.previous)).toEqual([null, null]);

    let gets = 0;
    const counting: ReadStateStore = {
      get: async () => {
        gets += 1;
        return null;
      },
      put: async () => {},
      delete: async () => {},
    };
    const missing = harness({ deps: { hooks: [spy], state: counting } });
    expectFailure(await missing.read({ path: "/missing.txt" }), "NOT_FOUND");
    expect(gets).toBe(0);
  });

  test("a schema 1 record from an older store gives null", async () => {
    const state = createMemoryStore();
    const legacy = {
      schema: 1,
      observationId: "obs-old",
      resolvedPath: "/a.txt",
      identity: null,
      contentId: "fnv:0",
      viewId: "fnv:0",
      observedAt: "2026-08-21T00:00:00.000Z",
      wholeFileVisible: true,
      totalsExact: true,
      request: { offset: 1, limit: 2_000 },
    };
    await state.put("/a.txt", legacy as unknown as ReadRecord);
    const { seen, hook: spy } = spyHook();
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { hooks: [spy], state } });
    expectOk(await read({ path: "/a.txt" }));
    expect(seen[0]?.ctx.previous).toBeNull();
    expect((await state.get("/a.txt"))?.schema).toBe(2);
  });

  test("state(call) runs once when both previous and record need it", async () => {
    const store = createMemoryStore();
    const calls: ReadContext<Host>[] = [];
    const read = createReadTool<Host>({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      digest: testDigest(),
      hooks: [{ id: "noop", afterRead: (outcome) => outcome }],
      state: (call) => {
        calls.push(call);
        return store;
      },
    });
    const call: ReadContext<Host> = { host: { id: "h" } };
    expectOk(await read({ path: "/a.txt" }, call));
    expectOk(await read({ path: "/a.txt" }, call));
    expect(calls).toEqual([call, call]);
    expect(await store.get("/a.txt")).not.toBeNull();
  });

  test("a throwing state factory gives EXTENSION_FAILED in the hooks phase", async () => {
    const { seen, hook: spy } = spyHook();
    const { read } = harness({
      files: { "/a.txt": "one\n" },
      deps: {
        hooks: [spy],
        state: () => {
          throw new Error("no session");
        },
      },
    });
    const result = expectFailure(await read({ path: "/a.txt" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({ extension: "state", phase: "hooks" });
    expect(seen).toHaveLength(0);
  });

  test("the record never holds host data from the hook context", async () => {
    const puts: ReadRecord[] = [];
    const store: ReadStateStore = {
      get: async () => null,
      put: async (_key, record) => {
        puts.push(record);
      },
      delete: async () => {},
    };
    const read = createReadTool<Host>({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      digest: testDigest(),
      hooks: [hook("shout", upper)],
      state: store,
    });
    await read({ path: "/a.txt" }, { host: { id: "host-sentinel-91be" } });
    expect(JSON.stringify(puts)).not.toContain("host-sentinel-91be");
  });
});
