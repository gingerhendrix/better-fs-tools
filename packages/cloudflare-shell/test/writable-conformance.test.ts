import { describe, expect, test } from "bun:test";

import { runWritableFileSystemConformance } from "@better-fs-tools/fs";

import { fsFor } from "./fake-workspace.ts";

describe("shell workspace write conformance", () => {
  test("passes the public write conformance suite", async () => {
    const { workspace, fs } = fsFor({ "/workspace/dir/a.txt": "a\n" });
    await workspace.mkdir("/workspace/scratch", { recursive: true });

    const report = await runWritableFileSystemConformance(fs, {
      scratchDirectory: "/workspace/scratch",
      directoryPath: "/workspace/dir",
      refusedPath: "/etc/passwd",
    });

    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.passed).toBe(true);
    const names = report.checks.map((check) => check.name);
    expect(names).toContain("remove with a stale version gives changed");
    expect(names).toContain("a refused path gives a policy reason");
    expect(names).not.toContain("stage then publish replaces the target");
    expect(names).not.toContain("a replace keeps the mode");
  });
});
