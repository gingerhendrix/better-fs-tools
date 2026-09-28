import { describe, expect, mock, test } from "bun:test";

import path from "node:path";

import * as read from "@better-fs-tools/read";

import { execute, fixtures, textOf } from "./helpers.ts";

const fixture = fixtures();

// Counts core tools. The wrapper delegates to the real function, so other test
// files that share this module registry behave the same.
let built = 0;
const real = { ...read };
void mock.module("@better-fs-tools/read", () => ({
  ...real,
  createReadTool: (deps: Parameters<typeof read.createReadTool>[0]) => {
    built += 1;
    return real.createReadTool(deps);
  },
}));
const { createPiReadTool } = await import("../src/index.ts");

describe("pi core tool", () => {
  test("one core tool serves every working directory", async () => {
    const parent = await fixture({ "a/x.txt": "a", "b/x.txt": "b", "c/x.txt": "c" });
    built = 0;
    const tool = createPiReadTool();
    expect(built).toBe(1);

    for (const name of ["a", "b", "c", "a"]) {
      expect(textOf(await execute(tool, { path: "x.txt" }, path.join(parent, name)))).toBe(
        `1|${name}`,
      );
    }
    expect(built).toBe(1);
  });
});
