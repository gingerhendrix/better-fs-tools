import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { ToolCallContext } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read";

import {
  createApplyPatchTool,
  createEditTool,
  createWriteTool,
  defaultWriteFormatter,
  memoryLocks,
} from "../../src/index.ts";
import { errorOf, errorCode, harness, testDigest } from "../helpers.ts";

interface Host {
  readonly secret: string;
}

describe("call scope (section 5.1)", () => {
  test("every extension point gets the same call object the caller passed", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one\n" } });
    const store = createMemoryStore();
    const seen = new Map<string, unknown[]>();
    const saw = (point: string, call: unknown) => {
      seen.set(point, [...(seen.get(point) ?? []), call]);
    };
    const formatter = defaultWriteFormatter();
    const write = createWriteTool<Host>({
      fs: (call) => {
        saw("fs", call);
        return fs;
      },
      state: (call) => {
        saw("state", call);
        return store;
      },
      digest: testDigest(),
      resolve: {
        id: "spy",
        resolve: (path, ctx) => {
          saw("resolve", ctx.call);
          return { kind: "path", path };
        },
      },
      authorize: {
        id: "spy",
        authorize: (target, ctx) => {
          saw(target.change === null ? "authorize:access" : "authorize:change", ctx.call);
          return { allow: true };
        },
      },
      guards: [
        {
          id: "spy",
          check: (_change, ctx) => {
            saw("guards", ctx.call);
            return { allow: true };
          },
        },
      ],
      hooks: [
        {
          id: "spy",
          newFileMode: (_change, ctx) => {
            saw("hooks:newFileMode", ctx.call);
            return null;
          },
          afterWrite: (_change, ctx) => {
            saw("hooks", ctx.call);
            return {};
          },
        },
      ],
      formatter: {
        id: "spy",
        format: (report, ctx) => {
          saw("formatter", ctx.call);
          return formatter.format(report, ctx);
        },
      },
    });
    const call: ToolCallContext<Host> = { host: { secret: "s3cret" }, callId: "c1" };
    const result = await write({ path: "/b.txt", content: "x" }, call);
    expect(result.status).toBe("ok");
    expect([...seen.keys()].sort()).toEqual([
      "authorize:access",
      "authorize:change",
      "formatter",
      "fs",
      "guards",
      "hooks",
      "hooks:newFileMode",
      "resolve",
      "state",
    ]);
    for (const calls of seen.values()) {
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(call);
    }
    // host never reaches the result or the record.
    expect(JSON.stringify(result)).not.toContain("s3cret");
    expect(JSON.stringify(await store.get("/b.txt"))).not.toContain("s3cret");
  });

  test("edit: every extension point gets the same call object the caller passed", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one\n" } });
    const seen = new Map<string, unknown[]>();
    const saw = (point: string, call: unknown) => {
      seen.set(point, [...(seen.get(point) ?? []), call]);
    };
    const formatter = defaultWriteFormatter();
    const edit = createEditTool<Host>({
      fs: (call) => {
        saw("fs", call);
        return fs;
      },
      state: (call) => {
        saw("state", call);
        return null;
      },
      digest: testDigest(),
      resolve: {
        id: "spy",
        resolve: (path, ctx) => {
          saw("resolve", ctx.call);
          return { kind: "path", path };
        },
      },
      authorize: {
        id: "spy",
        authorize: (target, ctx) => {
          saw(target.change === null ? "authorize:access" : "authorize:change", ctx.call);
          return { allow: true };
        },
      },
      guards: [
        {
          id: "spy",
          check: (_change, ctx) => {
            saw("guards", ctx.call);
            return { allow: true };
          },
        },
      ],
      hooks: [
        {
          id: "spy",
          afterWrite: (_change, ctx) => {
            saw("hooks", ctx.call);
            return {};
          },
        },
      ],
      formatter: {
        id: "spy",
        format: (report, ctx) => {
          saw("formatter", ctx.call);
          return formatter.format(report, ctx);
        },
      },
    });
    const call: ToolCallContext<Host> = { host: { secret: "s3cret" }, callId: "c2" };
    const result = await edit(
      { path: "/a.txt", edits: [{ oldText: "one", newText: "two" }] },
      call,
    );
    expect(result.status).toBe("ok");
    expect([...seen.keys()].sort()).toEqual([
      "authorize:access",
      "authorize:change",
      "formatter",
      "fs",
      "guards",
      "hooks",
      "resolve",
      "state",
    ]);
    for (const calls of seen.values()) {
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(call);
    }
    expect(JSON.stringify(result)).not.toContain("s3cret");
  });

  test("apply_patch: every extension point gets the same call object the caller passed", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one\n" } });
    const store = createMemoryStore();
    const seen = new Map<string, unknown[]>();
    const saw = (point: string, call: unknown) => {
      seen.set(point, [...(seen.get(point) ?? []), call]);
    };
    const formatter = defaultWriteFormatter();
    const applyPatch = createApplyPatchTool<Host>({
      fs: (call) => {
        saw("fs", call);
        return fs;
      },
      state: (call) => {
        saw("state", call);
        return store;
      },
      digest: testDigest(),
      preconditions: { requireRead: "off" },
      resolve: {
        id: "spy",
        resolve: (path, ctx) => {
          saw("resolve", ctx.call);
          return { kind: "path", path };
        },
      },
      authorize: {
        id: "spy",
        authorize: (target, ctx) => {
          saw(target.change === null ? "authorize:access" : "authorize:change", ctx.call);
          return { allow: true };
        },
      },
      guards: [
        {
          id: "spy",
          check: (_change, ctx) => {
            saw("guards", ctx.call);
            return { allow: true };
          },
        },
      ],
      hooks: [
        {
          id: "spy",
          newFileMode: (_change, ctx) => {
            saw("hooks:newFileMode", ctx.call);
            return null;
          },
          afterWrite: (_change, ctx) => {
            saw("hooks", ctx.call);
            return {};
          },
        },
      ],
      formatter: {
        id: "spy",
        format: (report, ctx) => {
          saw("formatter", ctx.call);
          return formatter.format(report, ctx);
        },
      },
    });
    const call: ToolCallContext<Host> = { host: { secret: "s3cret" }, callId: "c3" };
    const patch = [
      "*** Begin Patch",
      "*** Add File: /b.txt",
      "+b",
      "*** Update File: /a.txt",
      "@@",
      "-one",
      "+two",
      "*** End Patch",
    ].join("\n");
    const result = await applyPatch({ patch }, call);
    expect(result.status).toBe("ok");
    expect(Object.fromEntries([...seen].map(([point, calls]) => [point, calls.length]))).toEqual({
      fs: 1,
      state: 1,
      resolve: 2,
      "authorize:access": 2,
      "authorize:change": 2,
      guards: 2,
      "hooks:newFileMode": 1,
      hooks: 2,
      formatter: 1,
    });
    for (const calls of seen.values()) {
      for (const seenCall of calls) expect(seenCall).toBe(call);
    }
    expect(JSON.stringify(result)).not.toContain("s3cret");
    expect(JSON.stringify(await store.get("/b.txt"))).not.toContain("s3cret");
  });

  test("a direct caller without a context gets one fresh call object for the whole call", async () => {
    const calls: unknown[] = [];
    const fs = memoryFileSystem();
    const write = createWriteTool({
      fs: (call) => {
        calls.push(call);
        return fs;
      },
      guards: [
        {
          id: "spy",
          check: (_change, ctx) => {
            calls.push(ctx.call);
            return { allow: true };
          },
        },
      ],
    });
    await write({ path: "/a.txt", content: "x" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
    expect(calls[0]).toEqual({});
  });

  test("a non-object context throws", async () => {
    const write = createWriteTool({ fs: memoryFileSystem() });
    await expect(write({ path: "/a", content: "" }, "ctx" as never)).rejects.toThrow(TypeError);
  });

  test("invalid input is INVALID_INPUT and runs no stage", async () => {
    let factory = 0;
    const write = createWriteTool({
      fs: () => {
        factory += 1;
        return memoryFileSystem();
      },
    });
    const result = await write({ path: "/a.txt" } as never);
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "INVALID_INPUT",
      phase: "input",
      data: { path: "/a.txt" },
    });
    expect(result.notes[0]?.message).toBe("The write input was rejected: content must be a string");
    expect(factory).toBe(0);
  });

  test.each([
    [
      "throws",
      () => {
        throw new Error("no fs");
      },
    ],
    ["returns no filesystem", () => ({ id: "none" })],
  ])("an fs factory that %s is EXTENSION_FAILED", async (_name, factory) => {
    const write = createWriteTool({ fs: factory as never });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "EXTENSION_FAILED",
      phase: "resolve",
      data: { extension: "fs", phase: "resolve" },
    });
  });

  test("an fs factory that returns a read-only filesystem is UNSUPPORTED_BACKEND", async () => {
    const write = createWriteTool({ fs: (() => ({ id: "ro", open: async () => ({}) })) as never });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toMatchObject({ code: "UNSUPPORTED_BACKEND", phase: "resolve" });
    expect(result.notes[0]?.data).toEqual({ detail: "the filesystem has no write methods" });
  });

  test("a state factory runs once, and a throw stops the call before any commit", async () => {
    let runs = 0;
    const fs = memoryFileSystem();
    const ok = createWriteTool({
      fs,
      digest: testDigest(),
      state: () => {
        runs += 1;
        return createMemoryStore();
      },
    });
    await ok({ path: "/a.txt", content: "x" });
    expect(runs).toBe(1);

    const failing = createWriteTool({
      fs,
      digest: testDigest(),
      state: () => {
        throw new Error("no store");
      },
    });
    const result = await failing({ path: "/b.txt", content: "x" });
    expect(errorOf(result)).toMatchObject({ code: "EXTENSION_FAILED", phase: "precondition" });
    expect(fs.peek("/b.txt")).toBeNull();
  });

  test("an aborted signal before the call is ABORTED", async () => {
    const { fs, write } = harness();
    const result = await write({ path: "/a.txt", content: "x" }, { signal: AbortSignal.abort() });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "ABORTED",
      phase: "input",
      data: { phase: "input" },
    });
    expect(fs.peek("/a.txt")).toBeNull();
  });

  test("an abort while a host function hangs is ABORTED in its phase, and the lock is released", async () => {
    const fs = memoryFileSystem();
    const locks = memoryLocks({ timeoutMs: 50 });
    const controller = new AbortController();
    const hanging = createWriteTool({
      fs,
      locks,
      guards: [
        {
          id: "hang",
          check: () => {
            controller.abort();
            return new Promise(() => {});
          },
        },
      ],
    });
    const result = await hanging({ path: "/a.txt", content: "x" }, { signal: controller.signal });
    expect(errorOf(result)).toMatchObject({ code: "ABORTED", phase: "guards" });
    const next = createWriteTool({ fs, locks });
    expect((await next({ path: "/a.txt", content: "y" })).status).toBe("ok");
  });

  test("the lock is released after an error", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    const locks = memoryLocks({ timeoutMs: 50 });
    const store = createMemoryStore();
    const write = createWriteTool({ fs, locks, state: store, digest: testDigest() });
    expect(errorCode(await write({ path: "/a.txt", content: "x" }))).toBe("NOT_READ");
    expect(errorCode(await write({ path: "/a.txt", content: "x" }))).toBe("NOT_READ");
  });

  test("a lock timeout is LOCK_TIMEOUT", async () => {
    const fs = memoryFileSystem();
    const locks = memoryLocks({ timeoutMs: 10 });
    const held = await locks.acquire(["/a.txt"], {});
    const write = createWriteTool({ fs, locks });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "LOCK_TIMEOUT",
      phase: "lock",
    });
    expect(result.notes[0]?.message).toBe(
      "Another change to /a.txt is still running. Retry when it has finished.",
    );
    if (held.ok) held.release();
  });

  test("an abort while waiting for the lock is ABORTED in the lock phase", async () => {
    const fs = memoryFileSystem();
    const locks = memoryLocks();
    const held = await locks.acquire(["/a.txt"], {});
    const controller = new AbortController();
    const write = createWriteTool({ fs, locks });
    const pending = write({ path: "/a.txt", content: "x" }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 1);
    expect(errorOf(await pending)).toMatchObject({ code: "ABORTED", phase: "lock" });
    if (held.ok) held.release();
    expect((await write({ path: "/a.txt", content: "x" })).status).toBe("ok");
  });

  test("a lock manager that throws or returns garbage is EXTENSION_FAILED", async () => {
    for (const acquire of [
      async () => {
        throw new Error("boom");
      },
      async () => ({ ok: "maybe" }),
    ]) {
      const write = createWriteTool({
        fs: memoryFileSystem(),
        locks: { id: "bad", acquire: acquire as never },
      });
      const result = await write({ path: "/a.txt", content: "x" });
      expect(errorOf(result)).toMatchObject({
        code: "EXTENSION_FAILED",
        phase: "lock",
        data: { extension: "locks", id: "bad" },
      });
    }
  });

  test("a formatter exception does not reject the call", async () => {
    const write = createWriteTool({
      fs: memoryFileSystem(),
      formatter: {
        id: "broken",
        format: () => {
          throw new Error("format");
        },
      },
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.status).toBe("ok");
    expect(result.notes.map((note) => note.code)).toContain("extension-failed");
  });
});
