import { describe, expect, test } from "bun:test";

import { memoryFileSystem, runWritableFileSystemConformance } from "../src/index.ts";
import type {
  ConformanceReport,
  MemoryFileSystemOptions,
  WritableFileSystem,
} from "../src/index.ts";

function memoryFixture(options: MemoryFileSystemOptions = {}) {
  return memoryFileSystem({ directories: ["/work"], denyRoots: ["/forbidden"], ...options });
}

const FIXTURES = { scratchDirectory: "/work", refusedPath: "/forbidden/x.txt" };

function failed(report: ConformanceReport): string[] {
  return report.checks.filter((check) => !check.ok).map((check) => check.name);
}

describe("runWritableFileSystemConformance", () => {
  test("the memory adapter satisfies the write contract", async () => {
    const fs = memoryFixture();
    const report = await runWritableFileSystemConformance(fs, FIXTURES);
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.adapter).toBe("memory");
    expect(report.checks.map((check) => check.name)).toEqual([
      "shape",
      "write shape",
      "absent creates a file",
      "the bytes round-trip through open()",
      "stat of an existing file matches open().info.version",
      "absent on an existing file gives exists",
      "a stale version gives changed",
      "the current version replaces and changes the version",
      "any replaces",
      "stat of a missing path gives exists false and missingDirectories",
      "a missing parent is refused without createParents",
      "createParents creates and reports directories",
      "a new file takes options.mode",
      "a replace keeps the mode",
      "a directory target gives not-a-file",
      "a refused path gives a policy reason",
      "an aborted signal gives aborted",
      "remove with a stale version gives changed",
      "remove with the current version removes the file",
      "stage then publish replaces the target",
      "publish checks the precondition again",
      "stage then discard leaves nothing",
    ]);
  });

  test("the suite removes the files it created when remove() exists", async () => {
    const fs = memoryFixture();
    await runWritableFileSystemConformance(fs, FIXTURES);
    for (const path of [
      "/work/wfc-file.txt",
      "/work/wfc-mode.txt",
      "/work/wfc-parents/inner/x.txt",
    ]) {
      expect(fs.peek(path)).toBeNull();
    }
  });

  test("an adapter without stage() and remove() skips those checks and passes", async () => {
    const fs = memoryFixture({ stage: false, remove: false });
    const report = await runWritableFileSystemConformance(fs, { scratchDirectory: "/work" });
    expect(failed(report)).toEqual([]);
    const names = report.checks.map((check) => check.name);
    expect(names).not.toContain("stage then discard leaves nothing");
    expect(names).not.toContain("remove with the current version removes the file");
    expect(names).not.toContain("a refused path gives a policy reason");
  });

  test("without preserveMode the mode check on replace is skipped", async () => {
    const fs = memoryFixture({ writeCapabilities: { preserveMode: false } });
    const report = await runWritableFileSystemConformance(fs, FIXTURES);
    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => check.name)).not.toContain("a replace keeps the mode");
  });

  test("an adapter that ignores the version precondition fails", async () => {
    const fs = memoryFixture();
    const careless: WritableFileSystem = {
      ...fs,
      write: (path, bytes, options) =>
        fs.write(path, bytes, {
          ...options,
          precondition:
            options.precondition.kind === "version" ? { kind: "any" } : options.precondition,
        }),
    };
    const report = await runWritableFileSystemConformance(careless, FIXTURES);
    expect(report.passed).toBe(false);
    expect(failed(report)).toEqual(["a stale version gives changed"]);
  });

  test("a publish that skips the precondition fails", async () => {
    const fs = memoryFixture();
    const careless: WritableFileSystem = {
      ...fs,
      stage: (path, bytes, options) =>
        fs.stage!(path, bytes, { ...options, precondition: { kind: "any" } }),
    };
    const report = await runWritableFileSystemConformance(careless, FIXTURES);
    expect(failed(report)).toEqual(["publish checks the precondition again"]);
  });

  test("a stat version that differs from open fails", async () => {
    const fs = memoryFixture();
    const drifting: WritableFileSystem = {
      ...fs,
      stat: async (path, options) => {
        const outcome = await fs.stat(path, options);
        if (!outcome.ok || !outcome.stat.exists) return outcome;
        return { ok: true, stat: { ...outcome.stat, version: `${outcome.stat.version}!` } };
      },
    };
    const report = await runWritableFileSystemConformance(drifting, FIXTURES);
    expect(failed(report)).toContain("stat of an existing file matches open().info.version");
  });

  test("a read-only adapter fails the create check", async () => {
    const report = await runWritableFileSystemConformance(
      memoryFixture({ readOnly: true }),
      FIXTURES,
    );
    expect(report.passed).toBe(false);
    expect(failed(report)).toContain("absent creates a file");
  });

  test("missing write capabilities fail the write shape check", async () => {
    const fs = memoryFixture();
    const report = await runWritableFileSystemConformance(
      { ...fs, writeCapabilities: { atomic: true } } as unknown as WritableFileSystem,
      FIXTURES,
    );
    const shape = report.checks.find((check) => check.name === "write shape");
    expect(shape).toEqual({
      name: "write shape",
      ok: false,
      detail: "writeCapabilities.compareAndSwap missing",
    });
  });
});
