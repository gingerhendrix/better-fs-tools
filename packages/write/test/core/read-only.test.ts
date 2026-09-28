import { describe, expect, test } from "bun:test";

import { memoryFileSystem, readOnlyFileSystem } from "@better-fs-tools/fs";
import type { WritableFileSystem } from "@better-fs-tools/fs";
import { createReadTool } from "@better-fs-tools/read";

import { createApplyPatchTool, createEditTool, createWriteTool } from "../../src/index.ts";
import { errorOf } from "../helpers.ts";

describe("a read-only backend (decision W4)", () => {
  test("backs a read tool, and every write tool refuses it when it is built", async () => {
    const fs = readOnlyFileSystem(memoryFileSystem({ files: { "/a.txt": "one\n" } }));
    expect((await createReadTool({ fs })({ path: "/a.txt" })).status).toBe("ok");
    const message = "fs has no write methods: a write tool needs a WritableFileSystem";
    const asWritable = fs as WritableFileSystem;
    expect(() => createWriteTool({ fs: asWritable })).toThrow(message);
    expect(() => createEditTool({ fs: asWritable })).toThrow(message);
    expect(() => createApplyPatchTool({ fs: asWritable })).toThrow(message);
  });

  test("from a per-call factory, gives UNSUPPORTED_BACKEND with a clear detail", async () => {
    const fs = readOnlyFileSystem(memoryFileSystem({ files: { "/a.txt": "one\n" } }));
    const write = createWriteTool({ fs: () => fs as WritableFileSystem });
    const result = await write({ path: "/a.txt", content: "two\n" });
    expect(errorOf(result)?.code).toBe("UNSUPPORTED_BACKEND");
    expect(result.notes[0]?.message).toBe(
      "The backend cannot change /a.txt (the filesystem has no write methods); this is a configuration problem rather than a property of the file.",
    );
  });
});
