import { describe, expect, test } from "bun:test";

import {
  directoryListing,
  eofFooter,
  lineNumberFormatter,
  repeatReadGuard,
  textOf,
} from "../../src/index.ts";
import { createMemoryStore } from "../../src/state/index.ts";
import { harness } from "../helpers.ts";

const formatter = lineNumberFormatter({ footer: eofFooter() });

describe("eofFooter", () => {
  test("is shown when the view reaches EOF", async () => {
    const { read } = harness({ files: { "/a.txt": "one\ntwo\n" }, deps: { formatter } });
    expect(textOf(await read({ path: "/a.txt" }))).toBe(
      "1|one\n2|two\n(End of file - total 2 lines)",
    );
    expect(textOf(await read({ path: "/a.txt", offset: 2 }))).toBe(
      "2|two\n(End of file - total 2 lines)",
    );
  });

  test("takes its text from the option", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\n" },
      deps: { formatter: lineNumberFormatter({ footer: eofFooter((n) => `<eof ${n}>`) }) },
    });
    expect(textOf(await read({ path: "/a.txt" }))).toBe("1|one\n<eof 1>");
  });

  test("is left out before EOF, past EOF, and when the scan is capped", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\ntwo\nthree\n" },
      deps: { formatter },
    });
    expect(textOf(await read({ path: "/a.txt", limit: 1 }))).not.toContain("End of file");
    expect(textOf(await read({ path: "/a.txt", offset: 9 }))).not.toContain("End of file");

    const { read: capped } = harness({
      files: { "/a.txt": "one\ntwo\nthree\nfour\n" },
      limits: { maxScanBytes: 8, sampleBytes: 8 },
      deps: { formatter },
    });
    expect(textOf(await capped({ path: "/a.txt", limit: 1 }))).not.toContain("End of file");
  });

  test("counts an empty file and a clamped last line", async () => {
    const { read } = harness({
      files: { "/empty.txt": "", "/long.txt": "abcdef\n" },
      limits: { maxCharsPerLine: 3 },
      deps: { formatter },
    });
    expect(textOf(await read({ path: "/empty.txt" }))).toStartWith("(End of file - total 0 lines)");
    expect(textOf(await read({ path: "/long.txt" })).split("\n")[1]).toBe(
      "(End of file - total 1 lines)",
    );
  });

  test("is left out for a directory and for a view a hook emptied", async () => {
    const { read } = harness({
      files: { "/d/a.txt": "one\n" },
      deps: { formatter, converters: [directoryListing()] },
    });
    expect(textOf(await read({ path: "/d" }))).not.toContain("End of file");

    const { read: guarded } = harness({
      files: { "/a.txt": "one\n" },
      deps: { formatter, state: createMemoryStore(), hooks: [repeatReadGuard()] },
    });
    await guarded({ path: "/a.txt" });
    expect(textOf(await guarded({ path: "/a.txt" }))).not.toContain("End of file");
  });
});
