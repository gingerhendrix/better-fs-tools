import { describe, expect, test } from "bun:test";

import { directoryListing, textOf } from "../../src/index.ts";
import type { ViewBudget } from "../../src/index.ts";
import { expectFailure, expectOk, harness, lineText, note } from "../helpers.ts";

function lengthPlusOneBudget(max: number): ViewBudget & { measured: string[] } {
  const measured: string[] = [];
  return {
    id: "length",
    max,
    measured,
    measure(text) {
      measured.push(text);
      return text.length + 1;
    },
  };
}

const FILE = "aaaa\nbbbb\ncccc\ndddd\n";

describe("view budget", () => {
  test("stops at a line boundary with a continuation and reason budget", async () => {
    const budget = lengthPlusOneBudget(12);
    const { read } = harness({ files: { "/a.txt": FILE }, deps: { budget } });
    const result = expectOk(await read({ path: "/a.txt" }));

    expect(lineText(result)).toEqual(["aaaa", "bbbb"]);
    expect(result.truncation).toEqual({ truncated: true, reasons: ["budget"], primary: "budget" });
    expect(result.continuation.next).toEqual({ path: "/a.txt", offset: 3, limit: 2_000 });
    expect(note(result, "continue")).toMatchObject({
      retry: { path: "/a.txt", offset: 3, limit: 2_000 },
      data: { reason: "budget" },
    });
    expect(note(result, "continue")?.message).toContain("view budget");
    expect(result.view.partial).toBe(true);
    expect(result.totals).toEqual({ lines: 4, exact: true, bytes: 20 });
    expect(result.observation?.wholeFileVisible).toBe(false);
  });

  test("the continuation reads the next lines under the same budget", async () => {
    const { read } = harness({
      files: { "/a.txt": FILE },
      deps: { budget: lengthPlusOneBudget(12) },
    });
    const first = expectOk(await read({ path: "/a.txt" }));
    const next = first.continuation.next;
    if (next === null) throw new Error("expected a continuation");
    const second = expectOk(await read(next));
    expect(lineText(second)).toEqual(["cccc", "dddd"]);
    expect(second.continuation.available).toBe(false);
    expect(second.truncation.truncated).toBe(false);
  });

  test("measure runs once for each shown or stopping line, on the clamped text", async () => {
    const budget = lengthPlusOneBudget(100);
    const { read } = harness({
      files: { "/a.txt": `${"x".repeat(30)}\nshort\n` },
      limits: { maxCharsPerLine: 10 },
      deps: { budget },
    });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(budget.measured).toEqual(["x".repeat(10), "short"]);
    expect(result.truncation.reasons).toEqual(["line-length"]);
  });

  test("the first line of the view is always shown", async () => {
    const { read } = harness({
      files: { "/a.txt": FILE },
      deps: { budget: lengthPlusOneBudget(2) },
    });
    const result = expectOk(await read({ path: "/a.txt", offset: 2 }));
    expect(lineText(result)).toEqual(["bbbb"]);
    expect(result.truncation.primary).toBe("budget");
    expect(result.continuation.next).toEqual({ path: "/a.txt", offset: 3, limit: 2_000 });
  });

  test("the line limit and the byte limit stop the view first", async () => {
    const budget = lengthPlusOneBudget(10);
    const lines = harness({ files: { "/a.txt": FILE }, deps: { budget } });
    const byLines = expectOk(await lines.read({ path: "/a.txt", limit: 1 }));
    expect(byLines.truncation.reasons).toEqual(["lines"]);
    expect(budget.measured).toEqual(["aaaa"]);

    const bytes = harness({
      files: { "/a.txt": FILE },
      limits: { maxViewBytes: 8 },
      deps: { budget: lengthPlusOneBudget(10) },
    });
    const byBytes = expectOk(await bytes.read({ path: "/a.txt" }));
    expect(lineText(byBytes)).toEqual(["aaaa"]);
    expect(byBytes.truncation.reasons).toEqual(["bytes"]);
  });

  test("with no budget the view is unchanged", async () => {
    const { read } = harness({ files: { "/a.txt": FILE } });
    expect(textOf(expectOk(await read({ path: "/a.txt" })))).toBe("1|aaaa\n2|bbbb\n3|cccc\n4|dddd");
  });

  test("applies to converted text, such as a directory listing", async () => {
    const { read } = harness({
      files: { "/d/a.txt": "", "/d/b.txt": "", "/d/c.txt": "" },
      deps: { budget: lengthPlusOneBudget(12), converters: [directoryListing()] },
    });
    const result = expectOk(await read({ path: "/d" }));
    expect(lineText(result)).toEqual(["a.txt", "b.txt"]);
    expect(result.truncation.primary).toBe("budget");
    expect(result.continuation.next).toEqual({ path: "/d", offset: 3, limit: 2_000 });
  });

  test("a throwing measure gives EXTENSION_FAILED with the budget id", async () => {
    const budget: ViewBudget = {
      id: "broken",
      max: 10,
      measure() {
        throw new Error("no tokenizer");
      },
    };
    const { read } = harness({ files: { "/a.txt": FILE }, deps: { budget } });
    const result = expectFailure(await read({ path: "/a.txt" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({ extension: "budget", phase: "scan", id: "broken" });
  });

  test("a cost that is not a finite number of at least 0 gives EXTENSION_FAILED", async () => {
    for (const cost of [Number.NaN, -1, Number.POSITIVE_INFINITY, "3"]) {
      const budget = { id: "bad", max: 10, measure: () => cost } as unknown as ViewBudget;
      const { read } = harness({ files: { "/a.txt": FILE }, deps: { budget } });
      const result = expectFailure(await read({ path: "/a.txt" }), "EXTENSION_FAILED");
      expect(result.notes[0]?.data).toEqual({ extension: "budget", phase: "scan", id: "bad" });
    }
  });
});
