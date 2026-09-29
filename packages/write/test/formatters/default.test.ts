import { describe, expect, test } from "bun:test";

import { defaultWriteFormatter } from "../../src/index.ts";
import type { FileChange, MatchInfo, MutationReport, WriteFormatContext } from "../../src/index.ts";
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

const match = (overrides: Partial<MatchInfo>): MatchInfo => ({
  index: 0,
  matcher: "exact",
  fuzzy: false,
  lines: [1, 1],
  count: 1,
  replaced: [],
  ...overrides,
});

const report = (overrides: Record<string, unknown>): MutationReport =>
  ({
    tool: "write",
    status: "ok",
    changes: [],
    unchanged: [],
    notes: [],
    commit: null,
    ...overrides,
  }) as MutationReport;

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
      error: { code: "NOT_READ", phase: "precondition", message: "Read it first." },
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
      error: { code: "STALE", phase: "precondition", message: "x" },
      notes: [{ code: "stale", severity: "warning", message: "x" }],
    });
    expect(custom.format(failed, ctx())).toBe("write/stale");
  });

  test("edit: one replacement with its snippet", () => {
    const edited = report({
      tool: "edit",
      changes: [
        change({
          path: "src/app.ts",
          matches: [match({ replaced: [[12, 14]] })],
          snippets: [{ startLine: 11, lines: ["a", "b", "c", "d", "e"] }],
        }),
      ],
    });
    expect(formatter.format(edited, ctx())).toBe(
      "Edited src/app.ts: 1 replacement at lines 12-14.\n11|a\n12|b\n13|c\n14|d\n15|e",
    );
  });

  test("edit: a single line, several pairs sorted, and snippets split by ...", () => {
    const single = report({
      tool: "edit",
      changes: [change({ matches: [match({ replaced: [[4, 4]] })] })],
    });
    expect(formatter.format(single, ctx())).toBe("Edited src/app.ts: 1 replacement at line 4.");
    const several = report({
      tool: "edit",
      changes: [
        change({
          matches: [
            match({ index: 0, replaced: [[12, 14]] }),
            match({ index: 1, replaced: [[4, 4]] }),
            match({ index: 2, replaced: [[40, 40]] }),
          ],
          snippets: [
            { startLine: 4, lines: ["x"] },
            { startLine: 40, lines: ["y"] },
          ],
        }),
      ],
    });
    expect(formatter.format(several, ctx())).toBe(
      "Edited src/app.ts: 3 replacements at lines 4, 12-14, 40.\n4|x\n...\n40|y",
    );
  });

  test("edit: replace all, and more than maxListedMatches ranges end with …", () => {
    const replaced = Array.from({ length: 10 }, (_, index): [number, number] => [
      index * 3 + 1,
      index * 3 + 1,
    ]);
    const all = report({
      tool: "edit",
      changes: [change({ matches: [match({ count: 12, replaced })] })],
    });
    expect(formatter.format(all, ctx())).toBe(
      "Edited src/app.ts: 12 replacements (replace all) at lines 1, 4, 7, 10, 13, 16, 19, 22, 25, 28, ….",
    );
  });

  test("edit: user-modified content, no-change, and a custom gutter", () => {
    const user = report({
      tool: "edit",
      changes: [change({ userModified: true, snippets: [{ startLine: 2, lines: ["u"] }] })],
    });
    expect(defaultWriteFormatter({ gutter: (line) => `${line}\t` }).format(user, ctx())).toBe(
      "Edited src/app.ts with the user's changes (+12 -3 lines).\n2\tu",
    );
    expect(
      formatter.format(
        report({ tool: "edit", status: "no-change", unchanged: ["src/app.ts"] }),
        ctx(),
      ),
    ).toBe("No change to src/app.ts.");
  });

  test("rejects bad options", () => {
    expect(() => defaultWriteFormatter({ diff: "yes" } as never)).toThrow(TypeError);
    expect(() => defaultWriteFormatter({ gutter: 1 } as never)).toThrow(TypeError);
  });
});
