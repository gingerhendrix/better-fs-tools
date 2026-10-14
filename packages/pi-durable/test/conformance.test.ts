import { describe, expect, test } from "bun:test";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runFileSystemConformance, runWritableFileSystemConformance } from "@better-fs-tools/fs";

import { executionEnvFileSystem } from "../src/index.ts";
import { context, fixtures, localEnv } from "./helpers.ts";

const fixture = fixtures();
const ENCODER = new TextEncoder();

describe("execution environment conformance", () => {
  test("passes the public filesystem conformance suite", async () => {
    const outer = await fixture({ "secret.txt": "no\n" });
    const root = path.join(outer, "workspace");
    await mkdir(path.join(root, "dir"), { recursive: true });
    await writeFile(path.join(root, "a.txt"), "alpha\n");
    await writeFile(path.join(root, "dir", "b.txt"), "beta\n");
    const fs = executionEnvFileSystem(localEnv(root), { context, allowedRoots: [root] });

    const report = await runFileSystemConformance(fs, {
      existingFile: { path: path.join(root, "a.txt"), bytes: ENCODER.encode("alpha\n") },
      missingPath: path.join(root, "missing.txt"),
      directoryPath: path.join(root, "dir"),
      refusedPath: path.join(outer, "secret.txt"),
      listDirectory: path.join(root, "dir"),
      mutate: () => writeFile(path.join(root, "a.txt"), "changed and longer\n"),
    });
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.adapter).toBe("pi-durable:node:local");
  });

  test("passes the public write conformance suite", async () => {
    const outer = await fixture({ "secret.txt": "no\n" });
    const root = path.join(outer, "workspace");
    await mkdir(path.join(root, "scratch"), { recursive: true });
    await mkdir(path.join(root, "dir"), { recursive: true });
    const fs = executionEnvFileSystem(localEnv(root), { context, allowedRoots: [root] });

    const report = await runWritableFileSystemConformance(fs, {
      scratchDirectory: path.join(root, "scratch"),
      directoryPath: path.join(root, "dir"),
      refusedPath: path.join(outer, "secret.txt"),
    });
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
