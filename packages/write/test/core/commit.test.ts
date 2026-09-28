import { describe, expect, spyOn, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { MemoryFileSystem } from "@better-fs-tools/fs";

import { createWriteTool, memoryLocks } from "../../src/index.ts";
import type { Guard } from "../../src/index.ts";
import {
  codes,
  deferred,
  errorCode,
  harness,
  note,
  text,
  withoutCompareAndSwap,
} from "../helpers.ts";

/** A guard that changes the file on disk after load and before commit. */
function sneakyWriter(fs: MemoryFileSystem, path: string, contents: string): Guard<unknown> {
  return {
    id: "sneaky",
    check: () => {
      fs.setFile(path, contents);
      return { allow: true };
    },
  };
}

describe("commit (section 5.9)", () => {
  test("a write between load and commit is STALE on a compare-and-swap backend", async () => {
    const setup = harness({ files: { "/a.txt": "one\n" } });
    const { fs, read } = setup;
    await read({ path: "/a.txt" });
    const write = createWriteTool({
      fs,
      state: setup.state,
      digest: setup.digest,
      guards: [sneakyWriter(fs, "/a.txt", "theirs\n")],
    });
    const result = await write({ path: "/a.txt", content: "mine\n" });
    expect(result.error).toMatchObject({ code: "STALE", phase: "commit" });
    expect(text(fs, "/a.txt")).toBe("theirs\n");
  });

  test("without compare-and-swap the core's own check catches the same write", async () => {
    const setup = harness({ files: { "/a.txt": "one\n" } });
    const { fs, read } = setup;
    await read({ path: "/a.txt" });
    const write = createWriteTool({
      fs: withoutCompareAndSwap(fs),
      state: setup.state,
      digest: setup.digest,
      guards: [sneakyWriter(fs, "/a.txt", "theirs\n")],
    });
    const result = await write({ path: "/a.txt", content: "mine\n" });
    expect(result.error).toMatchObject({ code: "STALE", phase: "commit" });
    expect(text(fs, "/a.txt")).toBe("theirs\n");
  });

  test("without compare-and-swap a success carries the no-compare-and-swap note", async () => {
    const { fs, read, write } = harness({
      files: { "/a.txt": "one\n" },
      writeFs: withoutCompareAndSwap,
    });
    await read({ path: "/a.txt" });
    const result = await write({ path: "/a.txt", content: "two\n" });
    expect(result.status).toBe("ok");
    expect(note(result, "no-compare-and-swap")?.message).toContain("no-cas backend");
    expect(text(fs, "/a.txt")).toBe("two\n");
  });

  test("two creators with separate lock managers: one wins, one gets EXISTS", async () => {
    const fs = memoryFileSystem();
    const bothPlanned = deferred();
    let planned = 0;
    const barrier: Guard<unknown> = {
      id: "barrier",
      check: async () => {
        planned += 1;
        if (planned === 2) bothPlanned.resolve();
        await bothPlanned.promise;
        return { allow: true };
      },
    };
    const tool = () => createWriteTool({ fs, guards: [barrier], locks: memoryLocks() });
    const results = await Promise.all([
      tool()({ path: "/new.txt", content: "first" }),
      tool()({ path: "/new.txt", content: "second" }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["error", "ok"]);
    const loser = results.find((result) => result.status === "error");
    expect(loser?.error?.code).toBe("EXISTS");
    const winner = results.find((result) => result.status === "ok");
    expect(text(fs, "/new.txt")).toBe(winner === results[0] ? "first" : "second");
  });

  test("without compare-and-swap a file created after stat is EXISTS", async () => {
    const fs = memoryFileSystem();
    const write = createWriteTool({
      fs: withoutCompareAndSwap(fs),
      guards: [sneakyWriter(fs, "/new.txt", "theirs")],
    });
    const result = await write({ path: "/new.txt", content: "mine" });
    expect(result.error).toMatchObject({ code: "EXISTS", phase: "commit" });
    expect(text(fs, "/new.txt")).toBe("theirs");
  });

  test("one shared lock manager serializes two writers of one file", async () => {
    const fs = memoryFileSystem();
    const locks = memoryLocks();
    const order: string[] = [];
    const slow: Guard<unknown> = {
      id: "slow",
      check: async (change) => {
        order.push(`start ${change.after?.text}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`end ${change.after?.text}`);
        return { allow: true };
      },
    };
    const make = () => createWriteTool({ fs, locks, guards: [slow], state: null });
    const [first, second] = await Promise.all([
      make()({ path: "/f.txt", content: "a" }),
      make()({ path: "/f.txt", content: "b" }),
    ]);
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
    expect(first.status).toBe("ok");
    // The second writer found the file under the lock and replaced it without a store.
    expect(second.status).toBe("ok");
    expect(codes(second)).toContain("read-before-write-off");
  });

  test("capability notes: not-atomic and mode-not-kept", async () => {
    const { read, write } = harness({
      files: { "/a.txt": "one\n" },
      fsOptions: { writeCapabilities: { atomic: false, preserveMode: false } },
    });
    const created = await write({ path: "/b.txt", content: "x" });
    expect(codes(created)).toEqual(["not-atomic"]);
    await read({ path: "/a.txt" });
    const replaced = await write({ path: "/a.txt", content: "two\n" });
    expect(codes(replaced)).toEqual(["not-atomic", "mode-not-kept"]);
  });

  test.each([
    ["read-only", "READ_ONLY"],
    ["no-space", "NO_SPACE"],
    ["permission-denied", "PERMISSION_DENIED"],
  ] as const)("a %s refusal maps to %s", async (reason, code) => {
    const { write } = harness({
      fsOptions: { faults: (operation) => (operation === "write" ? { reason } : null) },
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.error).toMatchObject({ code, phase: "commit" });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.code).toBe(code.toLowerCase().replaceAll("_", "-"));
  });

  test("readOnly memory gives READ_ONLY", async () => {
    const { write } = harness({ fsOptions: { readOnly: true } });
    expect(errorCode(await write({ path: "/a.txt", content: "x" }))).toBe("READ_ONLY");
  });

  test("a throwing fs.write is IO_ERROR", async () => {
    const { fs, write } = harness();
    spyOn(fs, "write").mockImplementation(async () => {
      throw new Error("kaput");
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.error).toEqual({ code: "IO_ERROR", phase: "commit", data: { detail: "kaput" } });
  });

  test("an abort after the commit starts is ignored, and the record is stored", async () => {
    const setup = harness();
    const controller = new AbortController();
    const write = setup.fs.write.bind(setup.fs);
    spyOn(setup.fs, "write").mockImplementation(async (path, bytes, options) => {
      controller.abort();
      return write(path, bytes, options);
    });
    const result = await setup.write(
      { path: "/a.txt", content: "x" },
      { signal: controller.signal },
    );
    expect(result.status).toBe("ok");
    expect(await setup.state.get("/a.txt")).toMatchObject({ origin: "write" });
  });
});
