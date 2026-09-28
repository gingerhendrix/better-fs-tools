import { describe, expect, test } from "bun:test";

import { runWritableFileSystemConformance } from "@better-fs-tools/fs";
import { InMemoryFs } from "just-bash";

import { writable } from "./backend.ts";

describe("just-bash write conformance", () => {
  for (const identity of ["required", "none"] as const) {
    test(`passes the public write conformance suite with identity ${identity}`, async () => {
      const fs = new InMemoryFs({ "/workspace/dir/a.txt": "a\n" });
      await fs.mkdir("/workspace/scratch");

      const report = await runWritableFileSystemConformance(writable(fs, { identity }), {
        scratchDirectory: "/workspace/scratch",
        directoryPath: "/workspace/dir",
        refusedPath: "/outside.txt",
      });

      expect(report.checks.filter((check) => !check.ok)).toEqual([]);
      expect(report.passed).toBe(true);
      const names = report.checks.map((check) => check.name);
      expect(names).toContain("a replace keeps the mode");
      expect(names).toContain("remove with a stale version gives changed");
      expect(names).not.toContain("stage then publish replaces the target");
    });
  }
});
