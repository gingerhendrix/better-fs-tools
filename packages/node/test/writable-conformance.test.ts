import { describe, expect, test } from "bun:test";

import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWritableFileSystemConformance } from "@better-fs-tools/fs";

import { nodeFileSystem } from "../src/index.ts";

async function withScratch(run: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-write-conformance-")));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("write conformance", () => {
  test("the node adapter satisfies the write contract", async () => {
    await withScratch(async (root) => {
      const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
      const report = await runWritableFileSystemConformance(fs, {
        scratchDirectory: root,
        refusedPath: "/dev/null",
      });
      expect(report.checks.filter((check) => !check.ok)).toEqual([]);
      expect(report.passed).toBe(true);
      expect(report.checks.map((check) => check.name)).toContain(
        "publish checks the precondition again",
      );
      expect(report.checks.map((check) => check.name)).toContain("a replace keeps the mode");
      const names = await readdir(root, { recursive: true });
      expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    });
  });

  test("the suite passes with relative paths and symlinks rejected", async () => {
    await withScratch(async (root) => {
      const fs = nodeFileSystem({ cwd: root, allowedRoots: [root], symlinks: "reject" });
      const report = await runWritableFileSystemConformance(fs, { scratchDirectory: "." });
      expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    });
  });
});
