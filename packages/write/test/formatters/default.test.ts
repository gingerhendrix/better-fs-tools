import { describe, expect, test } from "bun:test";

import { defaultWriteFormatter } from "../../src/index.ts";
import type { FileChange, MutationReport, WriteFormatContext } from "../../src/index.ts";
import { defaultWriteLimits } from "../../src/index.ts";

const ctx = (mode: "model" | "view" = "model"): WriteFormatContext<unknown> => ({
  digest: null,
  limits: defaultWriteLimits,
  mode,
  call: { host: undefined },
});

const change = (overrides: Partial<FileChange>): FileChange => ({
  kind: "update",
  path: "src/app.ts",
  requestedPath: "src/app.ts",
  resolvedPath: "/w/src/app.ts",
  movedFrom: null,
  before: null,
  after: null,
  linesAdded: 12,
  linesRemoved: 3,
  diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-a\n+b\n",
  diffTruncated: false,
  matches: [],
  snippets: [],
  userModified: false,
  createdDirectories: [],
  ...overrides,
});

const report = (overrides: Partial<MutationReport>): MutationReport => ({
  tool: "write",
  status: "ok",
  error: null,
  changes: [],
  unchanged: [],
  notes: [],
  commit: null,
  ...overrides,
});

describe("defaultWriteFormatter", () => {
  const formatter = defaultWriteFormatter();

  test("write headers", () => {
    expect(
      formatter.format(
        report({ changes: [change({ kind: "create", path: "docs/notes.md", linesAdded: 42 })] }),
        ctx(),
      ),
    ).toBe("Created docs/notes.md (42 lines).");
    expect(
      formatter.format(report({ changes: [change({ kind: "create", linesAdded: 1 })] }), ctx()),
    ).toBe("Created src/app.ts (1 line).");
    expect(formatter.format(report({ changes: [change({})] }), ctx())).toBe(
      "Updated src/app.ts (+12 -3 lines).",
    );
    expect(
      formatter.format(report({ status: "no-change", unchanged: ["src/app.ts"] }), ctx()),
    ).toBe("No change to src/app.ts: the content is the same.");
  });

  test("notes follow a blank line; view mode drops them", () => {
    const notes = [{ code: "not-atomic", severity: "warning" as const, message: "Careful." }];
    const withNotes = report({ changes: [change({})], notes });
    expect(formatter.format(withNotes, ctx())).toBe(
      "Updated src/app.ts (+12 -3 lines).\n\n[write:not-atomic] Careful.",
    );
    expect(formatter.format(withNotes, ctx("view"))).toBe("Updated src/app.ts (+12 -3 lines).");
  });

  test("an error prints the note lines only", () => {
    const failed = report({
      status: "error",
      error: { code: "NOT_READ", phase: "precondition" },
      notes: [{ code: "not-read", severity: "warning", message: "Read it first." }],
    });
    expect(formatter.format(failed, ctx())).toBe("[write:not-read] Read it first.");
  });

  test("diff: true adds each diff in a fence", () => {
    const withDiff = defaultWriteFormatter({ diff: true });
    expect(withDiff.format(report({ changes: [change({})] }), ctx())).toBe(
      [
        "Updated src/app.ts (+12 -3 lines).",
        "```diff",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1 +1 @@",
        "-a",
        "+b",
        "```",
      ].join("\n"),
    );
  });

  test("a diff with a backtick run gets a longer fence", () => {
    const withDiff = defaultWriteFormatter({ diff: true });
    const text = withDiff.format(report({ changes: [change({ diff: "+```\n" })] }), ctx());
    expect(text).toContain("````diff\n+```\n````");
  });

  test("a custom note line", () => {
    const custom = defaultWriteFormatter({ noteLine: (note, tool) => `${tool}/${note.code}` });
    const failed = report({
      status: "error",
      notes: [{ code: "stale", severity: "warning", message: "x" }],
    });
    expect(custom.format(failed, ctx())).toBe("write/stale");
  });

  test("rejects bad options", () => {
    expect(() => defaultWriteFormatter({ diff: "yes" } as never)).toThrow(TypeError);
    expect(() => defaultWriteFormatter({ gutter: 1 } as never)).toThrow(TypeError);
  });
});
