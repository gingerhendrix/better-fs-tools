import { describe, expect, test } from "bun:test";

import { memoryFileSystem, runFileSystemConformance } from "../src/index.ts";
import type { FileSystem, OpenOutcome } from "../src/index.ts";

const ENCODER = new TextEncoder();

function memoryFixture() {
  const fs = memoryFileSystem({
    files: { "/a.txt": "alpha\n", "/dir/b.txt": "beta\n" },
    denyRoots: ["/forbidden"],
  });
  const fixtures = {
    existingFile: { path: "/a.txt", bytes: ENCODER.encode("alpha\n") },
    missingPath: "/missing.txt",
    directoryPath: "/dir",
    refusedPath: "/forbidden/x.txt",
    listDirectory: "/dir",
    mutate: () => fs.write("/a.txt", "changed\n"),
  };
  return { fs, fixtures };
}

describe("runFileSystemConformance", () => {
  test("the memory adapter satisfies the contract", async () => {
    const { fs, fixtures } = memoryFixture();
    const report = await runFileSystemConformance(fs, fixtures);
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.adapter).toBe("memory");
    expect(report.checks.map((check) => check.name)).toContain("not-a-file reports kind directory");
    expect(report.checks.map((check) => check.name)).toContain(
      "not-a-file reports the directory target",
    );
    expect(report.checks.map((check) => check.name)).toContain(
      "list() is bounded and returns names",
    );
  });

  test("an adapter without list() skips the listing check and still passes", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "alpha\n" }, list: false });
    const report = await runFileSystemConformance(fs, {
      existingFile: { path: "/a.txt", bytes: ENCODER.encode("alpha\n") },
      missingPath: "/missing.txt",
      listDirectory: "/",
    });
    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => check.name)).not.toContain(
      "list() is bounded and returns names",
    );
  });

  test("a wrong NotAFileError kind fails the kind check", async () => {
    const { fs, fixtures } = memoryFixture();
    const wrongKind: FileSystem = {
      ...fs,
      async open(path, options): Promise<OpenOutcome> {
        if (path === "/dir") {
          return { ok: false, error: { reason: "not-a-file", kind: "other", target: null } };
        }
        return fs.open(path, options);
      },
    };
    const report = await runFileSystemConformance(wrongKind, fixtures);
    const failed = report.checks.filter((check) => !check.ok);
    expect(failed).toEqual([
      { name: "not-a-file reports kind directory", ok: false, detail: "kind was other" },
      { name: "not-a-file reports the directory target", ok: false, detail: "target is null" },
    ]);
    expect(report.passed).toBe(false);
  });

  test("a verify() that misses a change fails the mutation check", async () => {
    const { fs, fixtures } = memoryFixture();
    const blind: FileSystem = {
      ...fs,
      async open(path, options) {
        const opened = await fs.open(path, options);
        if (!opened.ok) return opened;
        return {
          ok: true,
          file: { ...opened.file, verify: async () => ({ ok: true, changed: false }) },
        };
      },
    };
    const report = await runFileSystemConformance(blind, fixtures);
    expect(report.checks.find((check) => !check.ok)?.name).toBe(
      "verify() reports a mutated handle",
    );
  });
});
