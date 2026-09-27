import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, hashlineGutter, lineNumberFormatter, textOf } from "../../src/index.ts";
import { harness } from "../helpers.ts";

const formatter = lineNumberFormatter({ gutter: hashlineGutter() });

function gutters(text: string): string[] {
  return text.split("\n").map((line) => line.slice(0, line.indexOf("|") + 1));
}

describe("hashlineGutter", () => {
  test("prints the number, a colon, and the start of the line hash", async () => {
    const { read } = harness({ files: { "/a.txt": "one\ntwo\n" }, deps: { formatter } });
    expect(textOf(await read({ path: "/a.txt" }))).toMatch(
      /^1:[0-9a-f]{2}\|one\n2:[0-9a-f]{2}\|two$/u,
    );
  });

  test("ids are stable across reads and change after an edit", async () => {
    const { read, fs } = harness({
      files: { "/a.txt": "one\ntwo\nthree\n" },
      deps: { formatter: lineNumberFormatter({ gutter: hashlineGutter({ width: 8 }) }) },
    });
    const first = gutters(textOf(await read({ path: "/a.txt" })));
    const second = gutters(textOf(await read({ path: "/a.txt" })));
    expect(second).toEqual(first);

    fs.setFile("/a.txt", "one\nTWO\nthree\n");
    const edited = gutters(textOf(await read({ path: "/a.txt" })));
    expect(edited[0]).toBe(first[0]);
    expect(edited[1]).not.toBe(first[1]);
    expect(edited[2]).toBe(first[2]);
  });

  test("the id hashes the text only, so a moved line keeps its id", async () => {
    const { read, fs } = harness({
      files: { "/a.txt": "alpha\n" },
      deps: { formatter: lineNumberFormatter({ gutter: hashlineGutter({ width: 8 }) }) },
    });
    const before = gutters(textOf(await read({ path: "/a.txt" })))[0];
    fs.setFile("/a.txt", "new\nalpha\n");
    const after = gutters(textOf(await read({ path: "/a.txt" })))[1];
    expect(after?.slice(2)).toBe(before?.slice(2));
  });

  test("width sets the id length, up to the digest length", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\n" },
      deps: { formatter: lineNumberFormatter({ gutter: hashlineGutter({ width: 4 }) }) },
    });
    expect(textOf(await read({ path: "/a.txt" }))).toMatch(/^1:[0-9a-f]{4}\|one$/u);

    const { read: wide } = harness({
      files: { "/a.txt": "one\n" },
      deps: { formatter: lineNumberFormatter({ gutter: hashlineGutter({ width: 99 }) }) },
    });
    // The test digest gives "fnv:" and 8 hex characters.
    expect(textOf(await wide({ path: "/a.txt" }))).toMatch(/^1:[0-9a-f]{8}\|one$/u);
  });

  test("falls back to the number when digest is null", async () => {
    const read = createReadTool({
      fs: memoryFileSystem({ files: { "/a.txt": "one\ntwo\n" } }),
      formatter,
    });
    expect(textOf(await read({ path: "/a.txt" }))).toBe("1|one\n2|two");
  });

  test("a clamped line hashes its visible text", async () => {
    const { read, fs } = harness({
      files: { "/a.txt": "abcdef\n" },
      limits: { maxCharsPerLine: 3 },
      deps: { formatter: lineNumberFormatter({ gutter: hashlineGutter({ width: 8 }) }) },
    });
    const before = gutters(textOf(await read({ path: "/a.txt" })))[0];
    fs.setFile("/a.txt", "abcxyz\n");
    expect(gutters(textOf(await read({ path: "/a.txt" })))[0]).toBe(before);
  });

  test("rejects a width that is not a positive integer", () => {
    for (const width of [0, -1, 1.5, Number.NaN]) {
      expect(() => hashlineGutter({ width })).toThrow(TypeError);
    }
  });
});
