import { afterAll, describe, expect, test } from "bun:test";

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runFileSystemConformance } from "@better-fs-tools/fs";

import { nodeFileSystem } from "../src/index.ts";

const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-conformance-")));
await mkdir(join(root, "src"));
await writeFile(join(root, "src", "index.ts"), "const a = 1;\n");
await writeFile(join(root, "src", "notes.md"), "# notes\n");

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("adapter conformance", () => {
  test("the node adapter satisfies the published contract", async () => {
    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    const conformancePath = join(root, "conformance.txt");
    await writeFile(conformancePath, "alpha\n");
    let mutation = 0;
    const report = await runFileSystemConformance(fs, {
      existingFile: { path: "conformance.txt", bytes: new TextEncoder().encode("alpha\n") },
      missingPath: "conformance-missing.txt",
      directoryPath: "src",
      refusedPath: "/dev/null",
      listDirectory: "src",
      mutate: async () => {
        mutation += 1;
        await writeFile(conformancePath, `alpha${mutation}\n`);
      },
    });
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.adapter).toBe("node");
    expect(report.checks.map((check) => check.name)).toContain(
      "not-a-file reports the directory target",
    );
    expect(report.checks.map((check) => check.name)).toContain(
      "list() is bounded and returns names",
    );
  });
});
