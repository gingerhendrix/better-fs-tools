import { describe, expect, test } from "bun:test";

import { runFileSystemConformance } from "@better-fs-tools/fs";
import { InMemoryFs } from "just-bash";

import { adapter } from "./backend.ts";

const ENCODER = new TextEncoder();

describe("just-bash adapter conformance", () => {
  test("passes the public filesystem conformance suite", async () => {
    const fs = new InMemoryFs({
      "/workspace/conformance.txt": "alpha\n",
      "/workspace/dir/entry.txt": "entry\n",
    });
    const wrapped = adapter(fs);
    let mutation = 0;
    const report = await runFileSystemConformance(wrapped, {
      existingFile: { path: "conformance.txt", bytes: ENCODER.encode("alpha\n") },
      missingPath: "missing.txt",
      directoryPath: "dir",
      refusedPath: "/outside.txt",
      listDirectory: "dir",
      mutate: async () => {
        mutation += 1;
        await fs.writeFile("/workspace/conformance.txt", `alpha-${mutation}\n`);
      },
    });
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.adapter).toBe("test-just-bash");
    expect(report.checks.map((check) => check.name)).toContain("not-a-file reports kind directory");
    expect(report.checks.map((check) => check.name)).toContain(
      "not-a-file reports the directory target",
    );
    expect(report.checks.map((check) => check.name)).toContain(
      "list() is bounded and returns names",
    );
  });
});
