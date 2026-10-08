import { describe, expect, spyOn, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { MemoryFileSystem } from "@better-fs-tools/fs";

import { createWriteTool, memoryLocks } from "../../src/index.ts";
import type { Guard } from "../../src/index.ts";
import {
  errorOf,
  codes,
  deferred,
  errorCode,
  harness,
  text,
  withoutCompareAndSwap,
} from "../helpers.ts";

function guardThatRewritesFile(
  fs: MemoryFileSystem,
  path: string,
  contents: string,
): Guard<unknown> {
  return {
    id: "sneaky",
    check: () => {
      fs.setFile(path, contents);
      return { allow: true };
    },
  };
}

describe("commit", () => {
  test("a write between load and commit is STALE on a compare-and-swap backend", async () => {
    const setup = harness({ files: { "/a.txt": "one\n" } });
    const { fs, read } = setup;
    await read({ path: "/a.txt" });
    const write = createWriteTool({
      fs,
      state: setup.state,
      digest: setup.digest,
      guards: [guardThatRewritesFile(fs, "/a.txt", "theirs\n")],
    });
    const result = await write({ path: "/a.txt", content: "mine\n" });
    expect(errorOf(result)).toMatchObject({ code: "STALE", phase: "commit" });
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
      guards: [guardThatRewritesFile(fs, "/a.txt", "theirs\n")],
    });
    const result = await write({ path: "/a.txt", content: "mine\n" });
    expect(errorOf(result)).toMatchObject({ code: "STALE", phase: "commit" });
    expect(text(fs, "/a.txt")).toBe("theirs\n");
  });

  test("without compare-and-swap a success adds no note", async () => {
    const { fs, read, write } = harness({
      files: { "/a.txt": "one\n" },
      writeFs: withoutCompareAndSwap,
    });
    await read({ path: "/a.txt" });
    const result = await write({ path: "/a.txt", content: "two\n" });
    expect(result.status).toBe("ok");
    expect(codes(result)).toEqual([]);
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
      guards: [guardThatRewritesFile(fs, "/new.txt", "theirs")],
    });
    const result = await write({ path: "/new.txt", content: "mine" });
    expect(errorOf(result)).toMatchObject({ code: "EXISTS", phase: "commit" });
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
    expect(second.status).toBe("ok");
    expect(second.notes).toEqual([]);
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
    expect(errorOf(result)).toMatchObject({ code, phase: "commit" });
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]?.code).toBe(code.toLowerCase().replaceAll("_", "-"));
  });

  test("a backend byte ceiling gives TOO_LARGE, with the limit and the size", async () => {
    const { write, edit, read } = harness({
      files: { "/big.txt": "0123456789" },
      fsOptions: { maxBufferedBytes: 8 },
    });
    const written = await write({ path: "/a.txt", content: "0123456789" });
    expect(errorOf(written)).toMatchObject({ code: "TOO_LARGE", phase: "commit" });
    expect(written.notes).toEqual([
      {
        code: "too-large",
        severity: "warning",
        message:
          "The new content for /a.txt is larger than the 8-byte write limit. Write a smaller file.",
        data: {
          limit: 8,
          size: 10,
          detail: "object exceeds the 8-byte buffered ceiling",
        },
      },
    ]);
    await read({ path: "/big.txt" });
    const edited = await edit({ path: "/big.txt", edits: [{ oldText: "0", newText: "1" }] });
    expect(errorOf(edited)?.code).toBe("TOO_LARGE");
    expect(edited.notes[0]?.message).toBe(
      "/big.txt is larger than the 8-byte limit, so it cannot be changed with this tool.",
    );
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
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "IO_ERROR",
      phase: "commit",
      data: { detail: "kaput" },
    });
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
