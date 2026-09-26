import { describe, expect, test } from "bun:test";

import { nodeFileSystem } from "@better-fs-tools/node";
import {
  charsPerToken,
  createReadTool,
  lineNumberFormatter,
  textOf as coreText,
} from "@better-fs-tools/read";
import type { ReadLimits, ReadOk, ReadResult } from "@better-fs-tools/read";

import { createPiReadTool, toPiReadDetails } from "../src/index.ts";
import type { PiReadDetails } from "../src/index.ts";
import { execute, fixture, textOf } from "./helpers.ts";

function expectOk(result: ReadResult): ReadOk & ReadResult {
  if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
  return result;
}

/** A read of `text` through the Pi tool, plus the same read through the core. */
async function detailsFor(
  text: string,
  input: { path: string; offset?: number; limit?: number },
  limits?: Partial<ReadLimits>,
): Promise<{ result: ReadResult; details: PiReadDetails }> {
  const root = await fixture({ [input.path]: text });
  const tool = createPiReadTool(limits === undefined ? {} : { limits });
  const executed = await execute(tool, input, root);
  const read = createReadTool({
    fs: nodeFileSystem({ cwd: root, allowedRoots: [root] }),
    ...(limits === undefined ? {} : { limits }),
  });
  const result = await read(input);
  expect(textOf(executed)).toBe(coreText(result));
  return { result, details: executed.details };
}

describe("pi details mapping", () => {
  test("maps a line-limited read", async () => {
    const { result, details } = await detailsFor("one\ntwo\nthree\n", {
      path: "lines.txt",
      limit: 2,
    });
    const ok = expectOk(result);

    expect(ok.truncation).toEqual({ truncated: true, reasons: ["lines"], primary: "lines" });
    expect(details).toEqual({
      truncation: {
        content: "1|one\n2|two",
        truncated: true,
        truncatedBy: "lines",
        totalLines: ok.totals.lines as number,
        totalBytes: ok.totals.bytes,
        outputLines: 2,
        outputBytes: ok.view.bytes,
        lastLinePartial: false,
        firstLineExceedsLimit: false,
        maxLines: 2,
        maxBytes: 128 * 1_024,
      },
    });
  });

  test("maps a byte-limited read", async () => {
    const { result, details } = await detailsFor(
      "one\ntwo\nthree\n",
      { path: "bytes.txt" },
      { maxViewBytes: 7 },
    );
    const ok = expectOk(result);

    expect(ok.truncation.primary).toBe("bytes");
    // outputBytes is source bytes in the view, newlines included: the same
    // quantity maxViewBytes bounds, not the length of the numbered content.
    expect(details.truncation).toMatchObject({
      content: "1|one\n2|two",
      truncatedBy: "bytes",
      outputLines: 2,
      outputBytes: 7,
      firstLineExceedsLimit: false,
      maxLines: 2_000,
      maxBytes: 7,
    });
    expect(ok.view.bytes).toBe(7);
  });

  test("maps a first line that exceeds the byte limit", async () => {
    const { result, details } = await detailsFor(
      "hello\nx\n",
      { path: "first.txt" },
      { maxViewBytes: 4 },
    );
    const ok = expectOk(result);

    expect(ok.view.lines).toEqual([]);
    expect(details.truncation).toMatchObject({
      content: "",
      truncatedBy: "bytes",
      outputLines: 0,
      outputBytes: 0,
      firstLineExceedsLimit: true,
      maxBytes: 4,
    });
  });

  test("omits details for a clamp-only read", async () => {
    const { result, details } = await detailsFor(
      "abcdef\n",
      { path: "clamped.txt" },
      { maxCharsPerLine: 3 },
    );

    expect(expectOk(result).truncation).toEqual({
      truncated: true,
      reasons: ["line-length"],
      primary: "line-length",
    });
    expect(details).toEqual({});
  });

  test("omits details when the scan limit made the totals inexact", async () => {
    const { result, details } = await detailsFor(
      "one\ntwo\nthree\nfour\n",
      { path: "capped.txt", limit: 1 },
      { maxScanBytes: 6, sampleBytes: 6 },
    );
    const ok = expectOk(result);

    expect(ok.totals.exact).toBe(false);
    expect(ok.truncation.reasons).toContain("scan-limit");
    expect(details).toEqual({});
  });

  test("omits details for a view-budget stop", async () => {
    const root = await fixture({ "budget.txt": "aaaa\nbbbb\ncccc\n" });
    const budget = charsPerToken({ ratio: 4, max: 4 });
    const executed = await execute(createPiReadTool({ budget }), { path: "budget.txt" }, root);
    const read = createReadTool({
      fs: nodeFileSystem({ cwd: root, allowedRoots: [root] }),
      budget,
    });
    const ok = expectOk(await read({ path: "budget.txt" }));

    expect(ok.truncation).toEqual({ truncated: true, reasons: ["budget"], primary: "budget" });
    expect(ok.continuation.next).toEqual({ path: "budget.txt", offset: 3, limit: 2_000 });
    expect(textOf(executed)).toBe(coreText(ok));
    expect(executed.details).toEqual({});
    expect(toPiReadDetails(ok, "1|aaaa\n2|bbbb", 128 * 1_024)).toEqual({});
  });

  test("omits details for offset, whole-file, empty, unsupported, and error results", async () => {
    const offset = await detailsFor("one\ntwo\nthree\n", { path: "offset.txt", offset: 2 });
    expect(expectOk(offset.result).view.lines.map((line) => line.text)).toEqual(["two", "three"]);
    expect(offset.details).toEqual({});

    const pastEof = await detailsFor("one\ntwo\n", { path: "past.txt", offset: 9 });
    expect(expectOk(pastEof.result).view.lines).toEqual([]);
    expect(pastEof.details).toEqual({});

    const whole = await detailsFor("one\n", { path: "whole.txt" });
    expect(expectOk(whole.result).truncation.truncated).toBe(false);
    expect(whole.details).toEqual({});

    const empty = await detailsFor("", { path: "empty.txt" });
    expect(expectOk(empty.result).view.lines).toEqual([]);
    expect(empty.details).toEqual({});

    const root = await fixture({ "binary.bin": new Uint8Array([0, 1, 2, 3, 0, 255]) });
    const tool = createPiReadTool();
    expect((await execute(tool, { path: "binary.bin" }, root)).details).toEqual({});
    expect((await execute(tool, { path: "missing.txt" }, root)).details).toEqual({});
  });

  test("maps a result directly; a null view gives {}", async () => {
    const root = await fixture({ "lines.txt": "one\ntwo\nthree\n" });
    const read = createReadTool({ fs: nodeFileSystem({ cwd: root, allowedRoots: [root] }) });
    const result = await read({ path: "lines.txt", limit: 2 });
    const view = lineNumberFormatter().format(result, {
      digest: null,
      limits: { ...(await import("@better-fs-tools/read")).defaultLimits },
      mode: "view",
      call: { host: undefined },
    });

    expect(toPiReadDetails(result, view as string, 99).truncation).toMatchObject({
      content: "1|one\n2|two",
      maxBytes: 99,
    });
    expect(toPiReadDetails(result, null, 99)).toEqual({});
    expect(toPiReadDetails(await read({ path: "lines.txt" }), "1|one", 99)).toEqual({});
  });
});
