import { describe, expect, test } from "bun:test";

import { defaultClassifiers, notebookClassifier } from "@better-fs-tools/read";

import { nonTextGuard, recommendedGuards } from "../../src/index.ts";
import { errorOf, errorCode, harness, text } from "../helpers.ts";
import { change, guardContext, verdict } from "./helpers.ts";

const NOTEBOOK = JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 });

// The default chain reads a notebook as JSON text. These classifiers refuse it.
const withNotebooks = [notebookClassifier(), ...defaultClassifiers()];

function check(path: string, after: string, before: string | null = null) {
  return verdict(
    nonTextGuard().check(change({ path, before, after }), guardContext("write", withNotebooks)),
  );
}

describe("nonTextGuard", () => {
  test("refuses a new notebook when notebookClassifier() is in the chain", () => {
    expect(check("/n.ipynb", NOTEBOOK)).toBe("non-text");
    const decision = nonTextGuard().check(
      change({ path: "/n.ipynb", after: NOTEBOOK }),
      guardContext("write", withNotebooks),
    );
    expect(decision).toEqual({
      allow: false,
      note: {
        code: "non-text",
        severity: "warning",
        message:
          "The new content for /n.ipynb is not plain text (NOTEBOOK), so this tool will not write it. Send text content, or use a tool made for this kind of file.",
        data: { code: "NOTEBOOK", classifier: "notebook" },
      },
    });
  });

  test("allows a notebook with the default classifiers", () => {
    const decision = nonTextGuard().check(
      change({ path: "/n.ipynb", after: NOTEBOOK }),
      guardContext(),
    );
    expect(verdict(decision)).toBe("allow");
  });

  test("refuses content with NUL bytes, and an update that adds them", () => {
    expect(check("/a.txt", "a\u0000b")).toBe("non-text");
    expect(check("/a.txt", "a\u0000b", "ab")).toBe("non-text");
  });

  test("near miss: text content, including JSON that is not a notebook", () => {
    expect(check("/a.txt", "plain text\n")).toBe("allow");
    expect(check("/n.json", JSON.stringify({ cells: [] }))).toBe("allow");
    expect(check("/a.md", "# Title\n\nünïcödé → ✓\n")).toBe("allow");
    expect(check("/a.txt", "")).toBe("allow");
  });

  test("the sample is cut at limits.sampleBytes, as on load", () => {
    const ctx = guardContext();
    const late = `${"a".repeat(ctx.limits.sampleBytes)}\u0000`;
    expect(check("/a.txt", late)).toBe("allow");
  });

  test("in recommendedGuards(): write refuses a new .ipynb and writes nothing", async () => {
    const { fs, write } = harness({
      deps: { guards: recommendedGuards(), classifiers: withNotebooks },
    });
    const result = await write({ path: "/n.ipynb", content: NOTEBOOK });
    expect(errorCode(result)).toBe("GUARD_REFUSED");
    expect(errorOf(result)?.data).toMatchObject({ guard: "non-text", code: "NOTEBOOK" });
    expect(text(fs, "/n.ipynb")).toBeNull();
  });

  test("in recommendedGuards() with the default classifiers: write creates a .ipynb", async () => {
    const { fs, write } = harness({ deps: { guards: recommendedGuards() } });
    const result = await write({ path: "/n.ipynb", content: NOTEBOOK });
    expect(result.status).toBe("ok");
    expect(text(fs, "/n.ipynb")).toBe(NOTEBOOK);
  });
});
