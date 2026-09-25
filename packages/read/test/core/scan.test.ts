import { describe, expect, test } from "bun:test";

import { textOf } from "../../src/index.ts";
import { expectOk, harness, lineText, note } from "../helpers.ts";

describe("view selection", () => {
  test("renders numbered lines from a one-based offset", async () => {
    const { read } = harness({ files: { "/a.txt": "one\ntwo\nthree\n" } });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(lineText(result)).toEqual(["one", "two", "three"]);
    expect(textOf(result)).toBe("1|one\n2|two\n3|three");
    expect(result.view.startLine).toBe(1);
    expect(result.view.endLine).toBe(3);
    expect(result.view.partial).toBe(false);
    expect(result.truncation.truncated).toBe(false);
    expect(result.continuation.available).toBe(false);
  });

  test("counts a trailing newline exactly once", async () => {
    const { read } = harness({ files: { "/a.txt": "one\ntwo\n" } });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.totals.lines).toBe(2);
    expect(result.totals.exact).toBe(true);
    expect(result.continuation.available).toBe(false);
  });

  test("counts a file without a trailing newline exactly", async () => {
    const { read } = harness({ files: { "/a.txt": "one\ntwo" } });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.totals.lines).toBe(2);
    expect(lineText(result)).toEqual(["one", "two"]);
  });

  test("normalises CRLF and bare CR line endings", async () => {
    const { read } = harness({ files: { "/a.txt": "one\r\ntwo\rthree" } });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(lineText(result)).toEqual(["one", "two", "three"]);
    expect(result.totals.lines).toBe(3);
  });

  test("offset and limit select an interior window with an exact continuation", async () => {
    const { read } = harness({ files: { "/a.txt": "1\n2\n3\n4\n5\n" } });
    const result = expectOk(await read({ path: "/a.txt", offset: 2, limit: 2 }));
    expect(lineText(result)).toEqual(["2", "3"]);
    expect(result.view.startLine).toBe(2);
    expect(result.view.endLine).toBe(3);
    expect(result.continuation.next).toEqual({ path: "/a.txt", offset: 4, limit: 2 });
    expect(result.truncation.reasons).toEqual(["lines"]);
    expect(note(result, "continue")?.retry).toEqual({ path: "/a.txt", offset: 4, limit: 2 });

    const next = result.continuation.next;
    if (next === null) throw new Error("expected a continuation");
    expect(lineText(await read(next))).toEqual(["4", "5"]);
  });

  test("an offset past EOF reports the true line count", async () => {
    const { read } = harness({ files: { "/a.txt": "one\ntwo\n" } });
    const result = expectOk(await read({ path: "/a.txt", offset: 9 }));
    expect(result.view.lines).toEqual([]);
    expect(result.view.endLine).toBe(8);
    expect(result.totals.lines).toBe(2);
    const pastEof = note(result, "offset-past-eof");
    expect(pastEof?.data).toEqual({ totalLines: 2 });
    expect(pastEof?.retry).toEqual({ path: "/a.txt", offset: 2, limit: 2_000 });
  });

  test("an empty file is an ok result with an empty note", async () => {
    const { read } = harness({ files: { "/empty.txt": "" } });
    const result = expectOk(await read({ path: "/empty.txt" }));
    expect(result.view.lines).toEqual([]);
    expect(result.totals).toEqual({ lines: 0, exact: true, bytes: 0 });
    expect(note(result, "empty")?.severity).toBe("info");
    expect(result.observation?.wholeFileVisible).toBe(true);
  });
});

describe("bounds and disclosure", () => {
  test("clamps a long line and names it in the note data", async () => {
    const { read } = harness({
      files: { "/a.txt": `${"x".repeat(12)}\nshort\n` },
      limits: { maxCharsPerLine: 5 },
    });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.view.lines[0]).toEqual({
      number: 1,
      text: "xxxxx",
      clamped: true,
      sourceChars: 12,
    });
    expect(result.view.lines[1]?.clamped).toBe(false);
    expect(result.truncation.reasons).toContain("line-length");
    expect(note(result, "line-clamped")?.data).toEqual({ lines: [1], total: 1, maxChars: 5 });
    expect(textOf(result)).toContain("… [line truncated at 5 chars]");
    expect(result.observation?.wholeFileVisible).toBe(false);
  });

  test("stops at the view-byte ceiling and continues from the first unshown line", async () => {
    const { read } = harness({
      files: { "/a.txt": "aaaa\nbbbb\ncccc\n" },
      limits: { maxViewBytes: 8 },
    });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(lineText(result)).toEqual(["aaaa"]);
    expect(result.view.bytes).toBe(4);
    expect(result.truncation.primary).toBe("bytes");
    expect(result.continuation.next).toEqual({ path: "/a.txt", offset: 2, limit: 2_000 });
  });

  test("a first line that cannot fit offers a skip", async () => {
    const { read } = harness({
      files: { "/a.txt": "aaaaaaaaaaaa\nb\n" },
      limits: { maxViewBytes: 4 },
    });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.view.lines).toEqual([]);
    const skip = note(result, "first-line-exceeds-byte-limit");
    expect(skip?.retry).toEqual({ path: "/a.txt", offset: 2, limit: 2_000 });
  });

  test("the scan limit abandons totals and content identity but discloses both", async () => {
    const { read } = harness({
      files: { "/a.txt": "aa\nbb\ncc\ndd\n" },
      limits: { maxScanBytes: 6, sampleBytes: 3 },
    });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.totals.lines).toBeNull();
    expect(result.totals.exact).toBe(false);
    expect(result.observation?.contentId).toBeNull();
    expect(result.truncation.reasons).toContain("scan-limit");
    expect(note(result, "scan-limit")?.data).toEqual({ maxScanBytes: 6 });
    expect(result.continuation.available).toBe(true);
  });

  test("the scan never reads past maxScanBytes", async () => {
    const { fs } = harness({
      files: { "/big.txt": "x\n".repeat(10_000) },
      fsOptions: { chunkBytes: 10 },
    });
    let yielded = 0;
    const counting = {
      ...fs,
      async open(path: string, options: Parameters<typeof fs.open>[1]) {
        const opened = await fs.open(path, options);
        if (!opened.ok) return opened;
        const source = opened.file.bytes();
        return {
          ok: true as const,
          file: {
            ...opened.file,
            bytes: () =>
              (async function* count() {
                for await (const chunk of source) {
                  yielded += chunk.byteLength;
                  yield chunk;
                }
              })(),
          },
        };
      },
    };
    const { createReadTool } = await import("../../src/index.ts");
    const readCounting = createReadTool({
      fs: counting,
      limits: { maxScanBytes: 100, sampleBytes: 10 },
    });
    expectOk(await readCounting({ path: "/big.txt" }));
    // One chunk past the cap proves the stream has more bytes; nothing further is pulled.
    expect(yielded).toBe(110);
  });

  test("an offset the scan never reached retries from a bounded lower offset", async () => {
    const { read } = harness({
      files: { "/a.txt": "aa\nbb\ncc\ndd\nee\n" },
      limits: { maxScanBytes: 6, sampleBytes: 3 },
    });
    const result = expectOk(await read({ path: "/a.txt", offset: 50 }));
    const unreached = note(result, "offset-unreached");
    expect(unreached?.severity).toBe("warning");
    expect(unreached?.retry?.offset).toBe(3);
  });
});

describe("chunk boundaries", () => {
  test("a multi-byte character split across chunks decodes once", async () => {
    const { read } = harness({
      files: { "/u.txt": "héllo wörld\nsecond ✓ line\n" },
      fsOptions: { chunkBytes: 1 },
    });
    const result = expectOk(await read({ path: "/u.txt" }));
    expect(lineText(result)).toEqual(["héllo wörld", "second ✓ line"]);
    expect(result.totals.lines).toBe(2);
  });

  test("a CRLF split across chunks is one line break", async () => {
    const { read } = harness({
      files: { "/crlf.txt": "one\r\ntwo\r\n" },
      fsOptions: { chunkBytes: 4 },
    });
    const result = expectOk(await read({ path: "/crlf.txt" }));
    expect(lineText(result)).toEqual(["one", "two"]);
  });

  test("the scan continues past the window for exact totals", async () => {
    const { read } = harness({
      files: {
        "/many.txt": Array.from({ length: 500 }, (_, index) => `line ${index + 1}`).join("\n"),
      },
      fsOptions: { chunkBytes: 32 },
    });
    const result = expectOk(await read({ path: "/many.txt", limit: 3 }));
    expect(result.view.lines).toHaveLength(3);
    expect(result.totals.lines).toBe(500);
    expect(result.totals.exact).toBe(true);
    expect(result.observation?.contentId).not.toBeNull();
    expect(result.continuation.next?.offset).toBe(4);
  });

  test("a sample larger than the file is not padded", async () => {
    const { read } = harness({ files: { "/tiny.txt": "hi\n" }, limits: { sampleBytes: 4_096 } });
    const result = expectOk(await read({ path: "/tiny.txt" }));
    expect(result.totals.bytes).toBe(3);
    expect(lineText(result)).toEqual(["hi"]);
  });
});
