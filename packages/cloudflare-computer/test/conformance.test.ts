import { describe, expect, test } from "bun:test";

import { runFileSystemConformance } from "@better-fs-tools/fs";

import { fsFor } from "./fake-computer.ts";

const ENCODER = new TextEncoder();

describe("computer filesystem conformance", () => {
  test("passes the public filesystem conformance suite", async () => {
    const { backend, fs } = fsFor({
      "/workspace/a.txt": "alpha\n",
      "/workspace/dir/b.txt": "beta\n",
    });
    const report = await runFileSystemConformance(fs, {
      existingFile: { path: "/workspace/a.txt", bytes: ENCODER.encode("alpha\n") },
      missingPath: "/workspace/missing.txt",
      directoryPath: "/workspace/dir",
      refusedPath: "/etc/passwd",
      listDirectory: "/workspace/dir",
      mutate: () => backend.put("/workspace/a.txt", "changed\n"),
    });
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.adapter).toBe("cloudflare-computer");
    expect(report.checks.map((check) => check.name)).toContain("not-a-file reports kind directory");
    expect(report.checks.map((check) => check.name)).toContain(
      "not-a-file reports the directory target",
    );
    expect(report.checks.map((check) => check.name)).toContain(
      "list() is bounded and returns names",
    );
  });
});
