import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { WritableFileSystem } from "@better-fs-tools/fs";
import { createMemoryStore, sha256Digest } from "@better-fs-tools/read";
import type { Clock, Digest, Note, ToolAuthorizer, ToolCallContext } from "@better-fs-tools/read";
import { shellEnv } from "@better-fs-tools/shell";
import type { CommandRunner, RunExit } from "@better-fs-tools/shell";

import { createFsTools, memoryLocks } from "../../src/index.ts";
import type { LockManager } from "../../src/index.ts";
import { errorOf, FIXED_DATE, testDigest } from "../helpers.ts";

/** Exits 0 with no output. Records each command. */
function quietRunner(): CommandRunner & { commands: string[] } {
  const commands: string[] = [];
  return {
    id: "quiet",
    cwd: "/",
    commands,
    run(request) {
      commands.push(request.command);
      const exit: Promise<RunExit> = Promise.resolve({ code: 0, signal: null });
      return { exit, output: (async function* () {})() };
    },
  };
}

/** memoryLocks(), with every set of keys it was asked for. */
function spyLocks(): LockManager & { taken: string[][] } {
  const inner = memoryLocks();
  const taken: string[][] = [];
  return {
    id: "spy",
    taken,
    acquire(keys, options) {
      taken.push([...keys]);
      return inner.acquire(keys, options);
    },
  };
}

describe("createFsTools", () => {
  test("the four file tools share one store: edit needs a read first", async () => {
    const tools = createFsTools({ fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }) });
    const before = await tools.edit({ path: "/a.txt", edits: [{ oldText: "one", newText: "1" }] });
    expect(errorOf(before)?.code).toBe("NOT_READ");
    await tools.read({ path: "/a.txt" });
    const after = await tools.edit({ path: "/a.txt", edits: [{ oldText: "one", newText: "1" }] });
    expect(after.status).toBe("ok");
    // write sees the record that the edit left, so it can replace the file.
    expect((await tools.write({ path: "/a.txt", content: "two\n" })).status).toBe("ok");
  });

  test("the defaults are a memory store, sha256Digest(), memoryLocks(), and no bash", async () => {
    const tools = createFsTools({ fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }) });
    expect(tools.state).not.toBeNull();
    expect(tools.digest.id).toBe(sha256Digest().id);
    expect(tools.locks.id).toBe(memoryLocks().id);
    expect(tools.bash).toBeNull();
    await tools.read({ path: "/a.txt" });
    const record = await tools.state?.get("/a.txt");
    expect(record?.contentId).toBe(sha256Digest().hash("one\n"));
    expect(Object.isFrozen(tools)).toBe(true);
  });

  test("the default store expires records on the bundle clock", async () => {
    let now = Date.parse("2026-09-29T00:00:00.000Z");
    const tools = createFsTools({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      clock: () => new Date(now),
    });
    await tools.read({ path: "/a.txt" });
    expect(await tools.state?.get("/a.txt")).not.toBeNull();
    now += 31 * 60 * 1_000;
    expect(await tools.state?.get("/a.txt")).toBeNull();
  });

  test("one host denial note gives the same error note in read, write, and bash", async () => {
    const deny: ToolAuthorizer = {
      id: "policy",
      authorize: () => ({
        allow: false,
        note: { code: "POLICY_CODE", severity: "info", message: "No.", data: { rule: 7 } },
      }),
    };
    const tools = createFsTools({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      read: { authorize: deny },
      write: { authorize: deny },
      bash: { runner: quietRunner(), env: shellEnv(), authorize: deny },
    });
    const expected: Note = {
      code: "denied",
      severity: "warning",
      message: "No.",
      data: { rule: 7, source: "POLICY_CODE" },
    };
    for (const result of [
      await tools.read({ path: "/a.txt" }),
      await tools.write({ path: "/b.txt", content: "b" }),
      await tools.bash({ command: "ls" }),
    ]) {
      expect(result.status).toBe("error");
      expect(result.notes).toEqual([expected]);
    }
  });

  test("an abort before the start is ABORTED in phase input in every tool", async () => {
    const tools = createFsTools({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      bash: {
        runner: quietRunner(),
        env: shellEnv(),
        beforeRun: [{ id: "noop", beforeRun: () => ({ allow: true }) }],
      },
    });
    const call = { signal: AbortSignal.abort() } as const;
    const patch = "*** Begin Patch\n*** Add File: b.txt\n+b\n*** End Patch";
    for (const result of [
      await tools.read({ path: "/a.txt" }, call),
      await tools.edit({ path: "/a.txt", edits: [{ oldText: "one", newText: "1" }] }, call),
      await tools.write({ path: "/b.txt", content: "b" }, call),
      await tools.applyPatch({ patch }, call),
      await tools.bash({ command: "ls" }, call),
    ]) {
      expect(result.status === "error" ? [result.error.code, result.error.phase] : null).toEqual([
        "ABORTED",
        "input",
      ]);
    }
  });

  test("a per-call state factory throws TypeError that names createFsTools", () => {
    const factory = () => createMemoryStore();
    expect(() => createFsTools({ fs: memoryFileSystem(), state: factory } as never)).toThrow(
      "createFsTools state must be a read state store or null: a bundle takes one store, not a per-call factory",
    );
  });

  test("the three writers take the one lock manager", async () => {
    const locks = spyLocks();
    const tools = createFsTools({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      state: null,
      locks,
    });
    expect(tools.locks).toBe(locks);
    await tools.edit({ path: "/a.txt", edits: [{ oldText: "one", newText: "1" }] });
    await tools.write({ path: "/b.txt", content: "b\n" });
    await tools.applyPatch({ patch: "*** Begin Patch\n*** Add File: /c.txt\n+c\n*** End Patch" });
    expect(locks.taken).toEqual([["/a.txt"], ["/b.txt"], ["/c.txt"]]);
  });

  test("state null turns read-before-write off, and invalidate still stats", async () => {
    const tools = createFsTools({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      state: null,
    });
    const edited = await tools.edit({ path: "/a.txt", edits: [{ oldText: "one", newText: "1" }] });
    expect(edited.status).toBe("ok");
    expect(edited.notes.map((note) => note.code)).toContain("read-before-write-off");
    expect(await tools.invalidate("/a.txt")).toEqual({
      ok: true,
      resolvedPath: "/a.txt",
      recorded: false,
    });
  });

  test("invalidate deletes the record, so the next edit needs a read", async () => {
    const tools = createFsTools({ fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }) });
    await tools.read({ path: "/a.txt" });
    expect(await tools.invalidate("/a.txt")).toEqual({
      ok: true,
      resolvedPath: "/a.txt",
      recorded: true,
    });
    const edit = await tools.edit({ path: "/a.txt", edits: [{ oldText: "one", newText: "1" }] });
    expect(errorOf(edit)?.code).toBe("NOT_READ");
  });

  test("a per-call fs factory: invalidate needs the call", async () => {
    const backends = new Map<string, WritableFileSystem>([
      ["a", memoryFileSystem({ files: { "/x.txt": "a\n" } })],
      ["b", memoryFileSystem({ files: { "/x.txt": "b\n" } })],
    ]);
    const tools = createFsTools<{ readonly tenant: string }>({
      fs: (call) => backends.get(call.host.tenant) as WritableFileSystem,
    });
    const call: ToolCallContext<{ readonly tenant: string }> = { host: { tenant: "a" } };
    expect((await tools.read({ path: "/x.txt" }, call)).status).toBe("ok");
    expect(await tools.invalidate("/x.txt", call)).toMatchObject({ ok: true, recorded: true });
    expect(await tools.invalidate("/x.txt")).toEqual({
      ok: false,
      phase: "stat",
      error: {
        reason: "unsupported",
        detail: "fs is a factory: pass the call context to invalidate(path, call)",
      },
    });
    const broken = createFsTools<{ readonly tenant: string }>({
      fs: () => {
        throw new Error("no tenant");
      },
    });
    expect(await broken.invalidate("/x.txt", call)).toEqual({
      ok: false,
      phase: "stat",
      error: { reason: "io", detail: "no tenant" },
    });
  });

  test("bash is on only with an options object, and gets the shared digest and clock", async () => {
    const runner = quietRunner();
    const digest: Digest = testDigest();
    const clock: Clock = () => FIXED_DATE;
    const seen: { digest: Digest | null; now: Date }[] = [];
    const tools = createFsTools({
      fs: memoryFileSystem(),
      digest,
      clock,
      bash: {
        runner,
        env: shellEnv(),
        authorize: {
          id: "spy",
          authorize: (_target, ctx) => {
            seen.push({ digest: ctx.digest, now: ctx.clock() });
            return { allow: true };
          },
        },
      },
    });
    expect((await tools.bash({ command: "true" })).status).toBe("ok");
    expect(runner.commands).toEqual(["true"]);
    expect(seen).toEqual([{ digest, now: FIXED_DATE }]);
    expect(tools.clock).toBe(clock);
    expect(createFsTools({ fs: memoryFileSystem(), bash: false }).bash).toBeNull();
  });

  test("throws TypeError on an unknown key, a shared key in a tool, or bash: true", () => {
    const fs = memoryFileSystem();
    expect(() => createFsTools(null as never)).toThrow("createFsTools options must be an object");
    expect(() => createFsTools({ fs, bogus: true } as never)).toThrow(
      "Unknown createFsTools option: bogus",
    );
    for (const [tool, key] of [
      ["read", "fs"],
      ["read", "clock"],
      ["edit", "state"],
      ["write", "digest"],
      ["applyPatch", "locks"],
      ["bash", "digest"],
      ["bash", "clock"],
    ] as const) {
      const part =
        tool === "bash" ? { runner: quietRunner(), env: shellEnv(), [key]: null } : { [key]: null };
      expect(() => createFsTools({ fs, [tool]: part } as never)).toThrow(
        `createFsTools ${tool} options cannot set ${key}: set it once at the top level`,
      );
    }
    expect(() => createFsTools({ fs, edit: [] } as never)).toThrow(
      "createFsTools edit options must be an object",
    );
    expect(() => createFsTools({ fs, bash: true } as never)).toThrow(
      "createFsTools bash must be an object with a runner and an env",
    );
    // The core factories still check what they get.
    expect(() => createFsTools({ fs, bash: { runner: quietRunner() } } as never)).toThrow(
      "env is required",
    );
    expect(() => createFsTools({ fs: {} as never })).toThrow(TypeError);
    expect(() => createFsTools({ fs, state: createMemoryStore(), digest: {} as never })).toThrow(
      TypeError,
    );
  });
});
