import { describe, expect, test } from "bun:test";

import { runWritableFileSystemConformance } from "@better-fs-tools/fs";

import { fsFor } from "./fake-computer.ts";

describe("cloudflare computer write conformance", () => {
  test("passes the public write conformance suite", async () => {
    const { backend, fs } = fsFor({ "/workspace/dir/a.txt": "a\n" });
    await backend.mkdir("/workspace/scratch");

    const report = await runWritableFileSystemConformance(fs, {
      scratchDirectory: "/workspace/scratch",
      directoryPath: "/workspace/dir",
      refusedPath: "/etc/passwd",
    });

    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.passed).toBe(true);
    const names = report.checks.map((check) => check.name);
    expect(names).toContain("a new file takes options.mode");
    expect(names).toContain("a replace keeps the mode");
    expect(names).toContain("remove with a stale version gives changed");
    expect(names).not.toContain("stage then publish replaces the target");
  });
});
