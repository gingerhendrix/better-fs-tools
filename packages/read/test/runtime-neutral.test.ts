import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const PACKAGES = join(import.meta.dir, "..", "..");

/** Any `node:` specifier in a string, and bare Node built-in specifiers in import or require. */
const NODE_SPECIFIER =
  /["'`]node:|(?:from|import|require)\s*\(?\s*["'](?:fs|fs\/promises|path|os|crypto|child_process|process|stream|buffer|url|util)["']/u;

function offendingFiles(pkg: string): string[] {
  const root = join(PACKAGES, pkg, "src");
  const files = [...new Bun.Glob("**/*.ts").scanSync({ cwd: root, absolute: true })];
  expect(files.length).toBeGreaterThan(0);
  return files
    .filter((file) => NODE_SPECIFIER.test(readFileSync(file, "utf8")))
    .map((file) => relative(PACKAGES, file));
}

describe("runtime-neutral sources", () => {
  test("no file in packages/fs/src imports a Node built-in", () => {
    expect(offendingFiles("fs")).toEqual([]);
  });

  test("no file in packages/read/src imports a Node built-in", () => {
    expect(offendingFiles("read")).toEqual([]);
  });

  test("no file in packages/write/src imports a Node built-in", () => {
    expect(offendingFiles("write")).toEqual([]);
  });

  test("the pattern catches the forms it guards against", () => {
    for (const source of [
      'import { open } from "node:fs/promises";',
      'const { createHash } = await import("node:crypto");',
      'export { sep } from "node:path";',
      'import path from "path";',
      'const fs = require("fs");',
    ]) {
      expect(NODE_SPECIFIER.test(source)).toBe(true);
    }
    expect(NODE_SPECIFIER.test('import { memoryFileSystem } from "@better-fs-tools/fs";')).toBe(
      false,
    );
  });
});
