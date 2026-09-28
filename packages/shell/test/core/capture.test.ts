import { describe, expect, test } from "bun:test";

import { resolveShellLimits } from "@better-fs-tools/shell";

import { OutputCapture } from "../../src/core/capture.ts";
import { lines, out } from "../helpers.ts";

const limits = resolveShellLimits();

function capture(chunks: readonly string[] | readonly Uint8Array[], overrides = {}) {
  const resolved = resolveShellLimits(overrides);
  const bounded = new OutputCapture(resolved);
  for (const chunk of chunks) {
    bounded.push(typeof chunk === "string" ? out(chunk) : { stream: "stdout", bytes: chunk });
  }
  return bounded.view(resolved, null);
}

describe("OutputCapture", () => {
  test("small output is kept whole, with one final newline dropped", () => {
    const view = capture(["a\nb\n"]);
    expect(view).toMatchObject({ head: "a\nb", tail: null, totalLines: 2, omittedBytes: 0 });
  });

  test("a last line without a newline still counts", () => {
    expect(capture(["a\nb"]).totalLines).toBe(2);
  });

  test("10 MB in 64 KB chunks: head, tail, and counts are right", () => {
    const row = (index: number) => `row ${String(index).padStart(11, "0")}\n`; // 16 bytes
    const rowsPerChunk = 4_096;
    const chunks = 160;
    const bounded = new OutputCapture(limits);
    let index = 0;
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      let body = "";
      for (let row_ = 0; row_ < rowsPerChunk; row_ += 1) body += row(index++);
      bounded.push(out(body));
    }
    const view = bounded.view(limits, null);
    const total = rowsPerChunk * chunks;
    expect(view.totalBytes).toBe(total * 16);
    expect(view.totalLines).toBe(total);
    const headRows = view.head.split("\n");
    const tailRows = (view.tail ?? "").split("\n");
    expect(headRows[0]).toBe("row 00000000000");
    expect(tailRows.at(-1)).toBe(`row ${String(total - 1).padStart(11, "0")}`);
    // 20 percent of 30 000 bytes is 6 000 bytes, which is 375 whole rows.
    expect(headRows).toHaveLength(375);
    expect(tailRows).toHaveLength(1_500);
    expect(view.omittedLines).toBe(total - 375 - 1_500);
    expect(view.omittedBytes).toBe(view.totalBytes - (375 + 1_500) * 16);
  });

  test("small line budgets never show more lines than the budget", () => {
    const source = "one\ntwo\nthree\nfour\nfive\nsix\nseven\n";
    for (const headPercent of [1, 20, 50, 99, 100]) {
      for (let maxOutputLines = 1; maxOutputLines <= 5; maxOutputLines += 1) {
        const view = capture([source], { maxOutputLines, headPercent });
        const shown = [view.head, view.tail ?? ""].filter((part) => part !== "");
        const count = shown.join("\n").split("\n").length;
        expect({ headPercent, maxOutputLines, count }).toEqual({
          headPercent,
          maxOutputLines,
          count: Math.min(maxOutputLines, 7),
        });
        expect(view.omittedLines).toBe(7 - count);
      }
    }
  });

  test("maxOutputLines 1 with the default head percent shows only the last line", () => {
    const view = capture(["one\ntwo\nthree\n"], { maxOutputLines: 1 });
    expect(view.head).toBe("");
    expect(view.tail).toBe("three");
  });

  test("the line budget splits 20 / 80 when bytes fit", () => {
    const view = capture([lines(3_000)]);
    expect(view.head.split("\n")).toHaveLength(400);
    expect(view.tail?.split("\n")).toHaveLength(1_600);
    expect(view.tail?.split("\n").at(-1)).toBe("line 3000");
    expect(view.omittedLines).toBe(1_000);
  });

  test("a UTF-8 character split across chunks decodes once", () => {
    const bytes = new TextEncoder().encode("é€😀\n");
    const view = capture(Array.from(bytes, (byte) => Uint8Array.of(byte)));
    expect(view.head).toBe("é€😀");
  });

  test("one long line is cut at character boundaries, with no broken character", () => {
    const view = capture(["€".repeat(20_000)]);
    expect(view.head).not.toContain("�");
    expect(view.tail).not.toContain("�");
    expect(view.head.length + (view.tail?.length ?? 0)).toBe(10_000);
  });

  test("ANSI colour and cursor codes are removed", () => {
    expect(capture(["\u001b[31mred\u001b[0m \u001b]0;title\u0007done\n"]).head).toBe("red done");
  });

  test("invalid UTF-8 becomes replacement characters", () => {
    expect(capture([Uint8Array.of(0x61, 0xff, 0x62)]).head).toBe("a�b");
  });

  test("the tail does not repeat the head", () => {
    const view = capture([lines(40)], { maxOutputLines: 10 });
    expect(view.head).toBe("line 1\nline 2");
    expect(view.tail?.split("\n")[0]).toBe("line 33");
    expect(view.omittedLines).toBe(30);
  });
});
