import { describe, expect, test } from "bun:test";

import { codexPatchParser, parsePatch } from "../../src/patch/index.ts";
import type { PatchOperation, PatchParseOutcome } from "../../src/patch/index.ts";

function operations(outcome: PatchParseOutcome): readonly PatchOperation[] {
  if (!outcome.ok) throw new Error(`parse failed: ${JSON.stringify(outcome.error)}`);
  return outcome.plan.operations;
}

function patch(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

describe("parsePatch (plan section 4.8)", () => {
  test("add, delete, and update with a move, context, and End of File", () => {
    const text = patch(
      "*** Add File: docs/new.md",
      "+# Title",
      "+",
      "+body",
      "*** Delete File: old/unused.ts",
      "*** Update File: src/old-name.ts",
      "*** Move to: src/new-name.ts",
      "@@ function main() {",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      "@@",
      " last",
      "+added",
      "*** End of File",
    );
    expect(operations(parsePatch(text))).toEqual([
      { kind: "add", path: "docs/new.md", content: "# Title\n\nbody\n", line: 2 },
      { kind: "delete", path: "old/unused.ts", line: 6 },
      {
        kind: "update",
        path: "src/old-name.ts",
        moveTo: "src/new-name.ts",
        line: 7,
        hunks: [
          {
            context: "function main() {",
            lines: [
              { kind: " ", text: "const a = 1;" },
              { kind: "-", text: "const b = 2;" },
              { kind: "+", text: "const b = 3;" },
            ],
            endOfFile: false,
            line: 9,
          },
          {
            context: null,
            lines: [
              { kind: " ", text: "last" },
              { kind: "+", text: "added" },
            ],
            endOfFile: true,
            line: 13,
          },
        ],
      },
    ]);
  });

  test("the first hunk may leave out @@; a later one may not", () => {
    const first = operations(parsePatch(patch("*** Update File: a.ts", " x", "-y", "+z")));
    expect(first[0]).toMatchObject({
      hunks: [{ context: null, lines: [{ kind: " " }, { kind: "-" }, { kind: "+" }], line: 3 }],
    });
    const later = parsePatch(patch("*** Update File: a.ts", "@@", "-y", "+z", "", "x"));
    expect(later).toEqual({
      ok: false,
      error: { line: 7, detail: 'a hunk must start with "@@", got "x"' },
    });
  });

  test("an empty line inside a hunk is an empty context line; blank lines between hunks are skipped", () => {
    const [op] = operations(
      parsePatch(patch("*** Update File: a.ts", "@@", " a", "", "-b", "", "", "@@ c", "+d")),
    );
    expect(op).toMatchObject({
      hunks: [
        {
          lines: [
            { kind: " ", text: "a" },
            { kind: " ", text: "" },
            { kind: "-", text: "b" },
            { kind: " ", text: "" },
            { kind: " ", text: "" },
          ],
        },
        { context: "c", lines: [{ kind: "+", text: "d" }] },
      ],
    });
  });

  test("a bare @@ with trailing spaces has no context; @@ text keeps the text as written", () => {
    const [op] = operations(
      parsePatch(patch("*** Update File: a.ts", "@@  ", "-a", "@@   indented  ", "-b")),
    );
    expect(op).toMatchObject({ hunks: [{ context: null }, { context: "  indented  " }] });
  });

  test("a move with no hunks is a rename", () => {
    expect(operations(parsePatch(patch("*** Update File: a.ts", "*** Move to: b.ts")))[0]).toEqual({
      kind: "update",
      path: "a.ts",
      moveTo: "b.ts",
      hunks: [],
      line: 2,
    });
  });

  test("paths are trimmed and taken as written", () => {
    const ops = operations(parsePatch(patch("*** Delete File:   /abs/a b.ts  ")));
    expect(ops[0]).toEqual({ kind: "delete", path: "/abs/a b.ts", line: 2 });
  });

  test("$ sequences, backslashes, and marker-like text inside lines stay literal", () => {
    const [op] = operations(
      parsePatch(patch("*** Add File: a.txt", "+$& $$ $1 \\n", "+*** not a marker", "+ @@")),
    );
    expect(op).toMatchObject({ content: "$& $$ $1 \\n\n*** not a marker\n @@\n" });
  });
});

describe("leniency at the edges", () => {
  const body = patch("*** Delete File: a.ts");
  const expected: PatchOperation[] = [{ kind: "delete", path: "a.ts", line: 2 }];

  test("CRLF line breaks", () => {
    const [op] = operations(
      parsePatch(patch("*** Update File: a.ts", "@@", "-x", "+y").replaceAll("\n", "\r\n")),
    );
    expect(op).toMatchObject({
      hunks: [
        {
          lines: [
            { kind: "-", text: "x" },
            { kind: "+", text: "y" },
          ],
        },
      ],
    });
  });

  test("a missing final newline and surrounding blank lines", () => {
    expect(operations(parsePatch(body))).toEqual(expected);
    const padded = operations(parsePatch(`\n\n  \n${body}\n\n`));
    expect(padded).toEqual([{ kind: "delete", path: "a.ts", line: 5 }]);
  });

  test("one fenced block", () => {
    for (const fence of ["```", "```diff", "```patch"]) {
      const ops = operations(parsePatch(`${fence}\n${body}\n\`\`\`\n`));
      expect(ops).toEqual([{ kind: "delete", path: "a.ts", line: 3 }]);
    }
  });

  test("one heredoc wrapper, alone or inside a fence", () => {
    for (const open of ["apply_patch <<'EOF'", "apply_patch <<EOF", '<<"EOF"', "<<EOF"]) {
      const ops = operations(parsePatch(`${open}\n${body}\nEOF`));
      expect(ops).toEqual([{ kind: "delete", path: "a.ts", line: 3 }]);
    }
    const fenced = operations(
      parsePatch(`\`\`\`bash\napply_patch <<'PATCH'\n${body}\nPATCH\n\`\`\``),
    );
    expect(fenced).toEqual([{ kind: "delete", path: "a.ts", line: 4 }]);
  });

  test("a heredoc whose closing tag does not match is not stripped", () => {
    const outcome = parsePatch(`apply_patch <<'EOF'\n${body}\nEND`);
    expect(outcome).toEqual({
      ok: false,
      error: { line: 1, detail: 'the first line must be "*** Begin Patch"' },
    });
  });
});

describe("parse errors name the line", () => {
  test.each([
    ["an empty patch", "  \n\n", 1, "the patch is empty"],
    [
      "no Begin Patch",
      "*** Delete File: a\n*** End Patch",
      1,
      'the first line must be "*** Begin Patch"',
    ],
    [
      "no End Patch",
      "*** Begin Patch\n*** Delete File: a",
      2,
      'the last line must be "*** End Patch"',
    ],
    ["only Begin Patch", "*** Begin Patch", 1, 'the last line must be "*** End Patch"'],
    ["no operations", patch(), 2, "the patch has no file operations"],
    [
      "Environment ID",
      patch("*** Environment ID: dev", "*** Delete File: a"),
      2,
      "*** Environment ID is not supported. Remove the line.",
    ],
    [
      "an unknown header",
      patch("*** Rename File: a"),
      2,
      '"*** Rename File: a" is not a valid operation header. Use "*** Add File: <path>", "*** Delete File: <path>", or "*** Update File: <path>".',
    ],
    ["an empty path", patch("*** Delete File:   "), 2, "the file path is empty"],
    [
      "an empty Move to path",
      patch("*** Update File: a", "*** Move to: "),
      3,
      "the file path is empty",
    ],
    [
      "an Add with no + line",
      patch("*** Add File: a", "*** Delete File: b"),
      2,
      '*** Add File: a needs at least one "+" line',
    ],
    [
      "an Update with no hunk and no move",
      patch("*** Update File: a", "*** Delete File: b"),
      2,
      '*** Update File: a needs at least one hunk or a "*** Move to:" line',
    ],
    [
      "a hunk with no lines",
      patch("*** Update File: a", "@@ x", "*** End of File"),
      4,
      "the hunk has no lines",
    ],
    ["a bare @@ at the end", patch("*** Update File: a", "@@"), 3, "the hunk has no lines"],
    [
      "a line with no prefix",
      patch("*** Update File: a", "@@", "oops"),
      4,
      'unexpected line "oops" in a hunk. Every hunk line starts with " " (context), "-" (removed), or "+" (added).',
    ],
    [
      "End of File outside a hunk",
      patch("*** Delete File: a", "*** End of File"),
      3,
      '"*** End of File" is not a valid operation header. Use "*** Add File: <path>", "*** Delete File: <path>", or "*** Update File: <path>".',
    ],
  ])("%s", (_name, text, line, detail) => {
    expect(parsePatch(text)).toEqual({ ok: false, error: { line, detail } });
  });

  test("a non-string never throws", () => {
    expect(parsePatch(42 as unknown as string)).toEqual({
      ok: false,
      error: { line: 1, detail: "the patch must be a string" },
    });
  });
});

describe("codexPatchParser", () => {
  test("is parsePatch behind the PatchParser shape", () => {
    const parser = codexPatchParser();
    expect(parser.id).toBe("codex");
    expect(Object.isFrozen(parser)).toBe(true);
    const text = patch("*** Delete File: a");
    expect(parser.parse(text)).toEqual(parsePatch(text));
  });
});
