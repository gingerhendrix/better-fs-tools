import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import {
  createWriteTool,
  defaultWriteLimits,
  defaultWriteMessages,
  verifyWrite,
} from "../../src/index.ts";
import type { FileChange, WriteHook } from "../../src/index.ts";
import { codes, harness, note } from "../helpers.ts";

function hookThatSilentlyRewritesFile(content: string | null): WriteHook<unknown> {
  return {
    id: "sneaky",
    afterWrite: (change, ctx) => {
      const fs = ctx.fs as ReturnType<typeof memoryFileSystem>;
      if (content === null) fs.deleteFile(change.resolvedPath);
      else fs.setFile(change.resolvedPath, content);
      return {};
    },
  };
}

describe("verifyWrite", () => {
  test("a committed file that reads back the same adds nothing", async () => {
    const { read, write } = harness({
      files: { "/a.txt": "a\n" },
      deps: { hooks: [verifyWrite()] },
    });
    expect(codes(await write({ path: "/b.txt", content: "b\n" }))).toEqual([]);
    await read({ path: "/a.txt" });
    expect(codes(await write({ path: "/a.txt", content: "A\n" }))).toEqual([]);
  });

  test("a mismatch by hash adds a warning, and the status stays ok", async () => {
    const { write } = harness({
      deps: { hooks: [hookThatSilentlyRewritesFile("c\n"), verifyWrite()] },
    });
    const result = await write({ path: "/b.txt", content: "b\n" });
    expect(result.status).toBe("ok");
    expect(note(result, "verify-mismatch")).toEqual({
      code: "verify-mismatch",
      severity: "warning",
      message:
        "/b.txt does not hold the bytes that were written. Read it again before you change it.",
    });
  });

  test("without a digest it compares the size", async () => {
    const fs = memoryFileSystem();
    const run = async (content: string) => {
      const write = createWriteTool({
        fs,
        hooks: [hookThatSilentlyRewritesFile(content), verifyWrite()],
      });
      return codes(await write({ path: `/${content.length}.txt`, content: "b\n" }));
    };
    expect(await run("longer\n")).toEqual(["verify-mismatch"]);
    // Same size, other bytes: the size check cannot see it.
    expect(await run("c\n")).toEqual([]);
  });

  test("a file that cannot be read back adds verify-failed", async () => {
    const { write } = harness({
      deps: { hooks: [hookThatSilentlyRewritesFile(null), verifyWrite()] },
    });
    const result = await write({ path: "/b.txt", content: "b\n" });
    expect(note(result, "verify-failed")?.message).toBe(
      "/b.txt could not be read back to check the write. Read it before you change it again.",
    );
  });

  test("a removed file must be gone", async () => {
    const fs = memoryFileSystem({ files: { "/gone.txt": "x" } });
    const hook = verifyWrite();
    const change = {
      kind: "delete",
      path: "/gone.txt",
      requestedPath: "/gone.txt",
      resolvedPath: "/gone.txt",
      after: null,
    } as unknown as FileChange;
    const ctx = {
      fs,
      call: { host: undefined },
      limits: defaultWriteLimits,
      messages: defaultWriteMessages,
      digest: null,
    } as never;
    const present = await hook.afterWrite(change, ctx);
    expect(present.notes?.[0]).toMatchObject({
      code: "verify-mismatch",
      message: "/gone.txt still exists after it was removed. Check the file before you continue.",
    });
    fs.deleteFile("/gone.txt");
    expect(await hook.afterWrite(change, ctx)).toEqual({});
  });
});
