import { describe, expect, test } from "bun:test";

import { isWritableFileSystem, memoryFileSystem, readOnlyFileSystem } from "../src/index.ts";
import type { FileSystem } from "../src/index.ts";

describe("readOnlyFileSystem", () => {
  test("keeps the read members and drops every write member", async () => {
    const backing = memoryFileSystem({ files: { "/a.txt": "one\n" }, id: "mem" });
    const fs = readOnlyFileSystem(backing);
    expect(Object.keys(fs).sort()).toEqual(["capabilities", "id", "list", "open", "paths"]);
    expect(fs.id).toBe("mem");
    expect(fs.capabilities).toBe(backing.capabilities);
    expect(isWritableFileSystem(fs)).toBe(false);
    expect(Object.isFrozen(fs)).toBe(true);

    const opened = await fs.open("/a.txt", {});
    expect(opened.ok).toBe(true);
    if (opened.ok) await opened.file.close();
    const listed = await fs.list?.("/", { limit: 10 });
    expect(listed).toEqual({
      ok: true,
      entries: [{ name: "a.txt", type: "file" }],
      truncated: false,
    });
  });

  test("keeps the backend's policy and binds its methods", async () => {
    const backing = memoryFileSystem({ files: { "/secret/a": "x" }, denyRoots: ["/secret"] });
    const { open } = readOnlyFileSystem(backing);
    const outcome = await open("/secret/a", {});
    expect(outcome.ok ? null : outcome.error.reason).toBe("dangerous-path");
  });

  test("has no list when the backend has none", () => {
    const fs = readOnlyFileSystem(memoryFileSystem({ list: false }));
    expect("list" in fs).toBe(false);
  });

  test("refuses a value that is not a filesystem", () => {
    expect(() => readOnlyFileSystem(null as unknown as FileSystem)).toThrow(TypeError);
    expect(() => readOnlyFileSystem({} as FileSystem)).toThrow(TypeError);
  });
});
